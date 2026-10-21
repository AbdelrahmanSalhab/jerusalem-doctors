// Saving a licence re-runs the lookup server-side: what gets stored is what
// the registry said a moment ago, never a status the client supplied.

import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Record<string, unknown>[] = [];
const audits: Record<string, unknown>[] = [];

let doctor: Record<string, unknown> | null = null;
let mirrorRows: Record<string, unknown>[] = [];
let duplicateRow: Record<string, unknown> | null = null;
let updateError: { code: string } | null = null;

vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull: vi.fn(async () => ({ id: "00000000-0000-4000-8000-00000000a001" })) }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/moh/client", () => ({
  MohClient: class {
    async findByLicenses() {
      return [];
    }
  },
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: table === "moh_practitioners" ? mirrorRows : [], error: null }).then(ok),
        update(values: Record<string, unknown>) {
          updates.push(values);
          return { eq: async () => ({ error: updateError }) };
        },
        insert: async (row: Record<string, unknown>) => {
          if (table === "audit_logs") audits.push(row);
          return { error: null };
        },
      };
      for (const m of ["select", "eq", "neq", "in", "or", "order", "limit"]) {
        chain[m] = () => chain;
      }
      chain.maybeSingle = async () => {
        if (table === "doctors") return { data: doctor, error: null };
        if (table === "doctor_license_slots") return { data: duplicateRow, error: null };
        if (table === "moh_practitioners") return { data: mirrorRows[0] ?? null, error: null };
        return { data: null, error: null };
      };
      return chain;
    },
  }),
}));

const DOCTOR = {
  id: "00000000-0000-4000-8000-0000000000d1",
  hebrew_first_name: "דניאל",
  hebrew_family_name: "דריפוס",
  license_number: "999999",
  license_region: "IL",
  license_verification_status: "not_found",
  secondary_license_number: null,
  secondary_license_region: null,
  secondary_license_verification_status: null,
};

const MIRROR = {
  license_number: 189371,
  hebrew_first_name: "דניאל",
  hebrew_family_name: "דריפוס",
  hebrew_first_norm: "דניאל",
  hebrew_family_norm: "דריפוס",
  specialty_name_he: "פנימית",
  license_issued_yyyymmdd: 20110503,
  synced_at: "2026-10-19T03:00:00Z",
};

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new Request("https://example.test/api/admin/doctors/d1/license/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-0000000000d1" }) },
  );
}

beforeEach(() => {
  updates.length = 0;
  audits.length = 0;
  doctor = { ...DOCTOR };
  mirrorRows = [];
  duplicateRow = null;
  updateError = null;
});

describe("POST .../license/save", () => {
  it("stores a corrected number with the status the registry gives", async () => {
    mirrorRows = [MIRROR];
    const res = await call({ slot: "primary", license_number: "189371", expected_status: "verified" });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({
      license_number: "189371",
      license_region: "IL",
      license_verification_status: "verified",
    });
    expect(typeof updates[0].license_verified_at).toBe("string");
  });

  it("logs the correction as before and after", async () => {
    mirrorRows = [MIRROR];
    await call({ slot: "primary", license_number: "189371", expected_status: "verified" });
    expect(audits[0]).toMatchObject({
      action: "admin_license_corrected",
      metadata: {
        license_number_before: "999999",
        license_number_after: "189371",
        license_status_before: "not_found",
        license_status_after: "verified",
      },
    });
  });

  // The case nothing in the app could fix before: a signup-day miss that the
  // registry has since been able to answer.
  it("updates the status alone when only the verdict moved", async () => {
    doctor = { ...DOCTOR, license_number: "189371" };
    mirrorRows = [MIRROR];
    const res = await call({ slot: "primary", license_number: "189371", expected_status: "verified" });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ license_verification_status: "verified" });
    expect(audits[0]).toMatchObject({ action: "admin_license_rechecked" });
    expect(audits[0].metadata).not.toHaveProperty("license_number_before");
  });

  it("writes nothing when neither the number nor the verdict changed", async () => {
    doctor = { ...DOCTOR, license_number: "189371", license_verification_status: "verified" };
    mirrorRows = [MIRROR];
    const res = await call({ slot: "primary", license_number: "189371", expected_status: "verified" });
    expect(res.status).toBe(200);
    expect((await res.json()).changed).toBe(false);
    expect(updates).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("refuses when the registry's answer moved since the admin looked", async () => {
    mirrorRows = [MIRROR];
    const res = await call({ slot: "primary", license_number: "189371", expected_status: "not_found" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("result_changed");
    expect(updates).toEqual([]);
  });

  it("will not store a number belonging to another name without an override", async () => {
    mirrorRows = [{ ...MIRROR, hebrew_first_name: "משה", hebrew_first_norm: "משה" }];
    const res = await call({ slot: "primary", license_number: "189371" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("name_mismatch");
    expect(updates).toEqual([]);
  });

  it("stores an overridden mismatch, with the reason, as the only form there is", async () => {
    mirrorRows = [{ ...MIRROR, hebrew_first_name: "משה", hebrew_first_norm: "משה" }];
    const res = await call({
      slot: "primary",
      license_number: "189371",
      override_name_mismatch: true,
      reason: "راجعت صورة الترخيص",
    });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ license_verification_status: "name_mismatch_overridden" });
    // Not verified and not a soft match, so no verification timestamp.
    expect(updates[0].license_verified_at).toBeNull();
    expect(audits[0]).toMatchObject({
      metadata: { override_name_mismatch: true, reason: "راجعت صورة الترخيص" },
    });
  });

  it("names the doctor already holding the number instead of failing with a 500", async () => {
    mirrorRows = [MIRROR];
    updateError = { code: "23505" };
    duplicateRow = { doctor_id: "00000000-0000-4000-8000-0000000000d2", doctor: { arabic_first_name: "خالد", arabic_family_name: "سلهب" } };
    const res = await call({ slot: "primary", license_number: "189371", expected_status: "verified" });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("duplicate_license");
    expect(body.fields.license_number).toContain("خالد سلهب");
  });

  it("writes the secondary slot's own columns, which have no timestamp", async () => {
    doctor = { ...DOCTOR, secondary_license_number: "111", secondary_license_region: "IL" };
    mirrorRows = [MIRROR];
    const res = await call({ slot: "secondary", license_number: "189371", expected_status: "verified" });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({
      secondary_license_number: "189371",
      secondary_license_verification_status: "verified",
    });
    expect(updates[0]).not.toHaveProperty("license_verified_at");
    expect(audits[0]).toMatchObject({ metadata: { slot: "secondary" } });
  });

  // A partial match is a spelling difference, not a different person: the one
  // way to make it read "موثّق" honestly is to stop storing the spelling the
  // registry disagrees with.
  it("takes the registry's spelling and the exact match that follows from it", async () => {
    doctor = { ...DOCTOR, hebrew_first_name: "דנאל", license_number: "189371", license_verification_status: "soft_match" };
    mirrorRows = [MIRROR];
    const res = await call({
      slot: "primary",
      license_number: "189371",
      expected_status: "soft_match",
      adopt_registry_name: true,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).hebrew_name_changed).toBe(true);
    expect(updates[0]).toMatchObject({
      hebrew_first_name: "דניאל",
      hebrew_family_name: "דריפוס",
      license_verification_status: "verified",
    });
    expect(audits[0]).toMatchObject({
      metadata: { adopted_registry_name: true, hebrew_name_before: "דנאל דריפוס", hebrew_name_after: "דניאל דריפוס" },
    });
  });

  it("leaves the name alone, and the partial match standing, when not asked to adopt", async () => {
    doctor = { ...DOCTOR, hebrew_first_name: "דנאל", license_number: "189371", license_verification_status: "not_found" };
    mirrorRows = [MIRROR];
    const res = await call({ slot: "primary", license_number: "189371", expected_status: "soft_match" });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ license_verification_status: "soft_match" });
    expect(updates[0]).not.toHaveProperty("hebrew_first_name");
  });

  // Adopting there would rewrite a doctor into whoever holds the number.
  it("refuses to adopt a name the registry gives to someone else", async () => {
    doctor = { ...DOCTOR, license_number: "189371" };
    mirrorRows = [{ ...MIRROR, hebrew_first_name: "משה", hebrew_first_norm: "משה" }];
    const res = await call({ slot: "primary", license_number: "189371", adopt_registry_name: true });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("name_not_adoptable");
    expect(updates).toEqual([]);
  });

  it("404s for a doctor that does not exist", async () => {
    doctor = null;
    expect((await call({ slot: "primary", license_number: "189371" })).status).toBe(404);
  });

  it("rejects a bad number before touching the registry", async () => {
    const res = await call({ slot: "primary", license_number: "2-45678" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_license");
  });
});
