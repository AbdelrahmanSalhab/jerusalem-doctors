// Looking a licence up must never write anything: the admin sees the result
// first and saves it with a separate call.

import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Record<string, unknown>[] = [];

let doctor: Record<string, unknown> | null = null;
let mirrorRows: Record<string, unknown>[] = [];
let duplicateRow: Record<string, unknown> | null = null;
let liveThrows = false;

vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull: vi.fn(async () => ({ id: "00000000-0000-4000-8000-00000000a001" })) }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: true })) }));

vi.mock("@/lib/moh/client", () => ({
  MohClient: class {
    async findByLicenses() {
      if (liveThrows) throw new Error("data.gov.il timeout");
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
          return { eq: async () => ({ error: null }) };
        },
        insert: async () => ({ error: null }),
      };
      for (const m of ["select", "eq", "neq", "in", "or", "order", "limit"]) {
        chain[m] = () => chain;
      }
      chain.maybeSingle = async () => {
        if (table === "doctors") return { data: doctor, error: null };
        if (table === "doctor_license_slots") return { data: duplicateRow, error: null };
        // moh_practitioners single-row lookup inside verifyLicense.
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
  license_number: "189371",
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

async function call(body: unknown, id = "00000000-0000-4000-8000-0000000000d1") {
  const { POST } = await import("./route");
  return POST(
    new Request(`https://example.test/api/admin/doctors/${id}/license/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  updates.length = 0;
  doctor = { ...DOCTOR };
  mirrorRows = [];
  duplicateRow = null;
  liveThrows = false;
});

describe("POST .../license/check", () => {
  it("reports a match and what saving it would store", async () => {
    mirrorRows = [MIRROR];
    const res = await call({ slot: "primary", license_number: "189371" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("verified");
    expect(body.column_status).toBe("verified");
    expect(body.explanation.headline).toContain("مطابق لسجل وزارة الصحة");
  });

  it("writes nothing at all, whatever it finds", async () => {
    mirrorRows = [MIRROR];
    await call({ slot: "primary", license_number: "189371" });
    expect(updates).toEqual([]);
  });

  it("names the rule behind a partial match and the registry's spelling", async () => {
    mirrorRows = [{ ...MIRROR, hebrew_family_name: "דריפו", hebrew_family_norm: "דריפו" }];
    const body = await (await call({ slot: "primary", license_number: "189371" })).json();
    expect(body.status).toBe("soft_match");
    expect(body.match).toEqual({ first: "exact", family: "substring" });
    expect(body.registry.familyName).toBe("דריפו");
  });

  it("reports a number belonging to someone else, without storing it", async () => {
    mirrorRows = [{ ...MIRROR, hebrew_first_name: "משה", hebrew_first_norm: "משה" }];
    const body = await (await call({ slot: "primary", license_number: "189371" })).json();
    expect(body.status).toBe("name_mismatch");
    // No column holds a bare mismatch, so a save would have to be an override.
    expect(body.column_status).toBeNull();
    expect(updates).toEqual([]);
  });

  it("warns up front when another doctor already holds the number", async () => {
    mirrorRows = [MIRROR];
    duplicateRow = { doctor_id: "00000000-0000-4000-8000-0000000000d2", doctor: { arabic_first_name: "خالد", arabic_family_name: "سلهب" } };
    const body = await (await call({ slot: "primary", license_number: "189371" })).json();
    expect(body.duplicate_of).toEqual({ id: "00000000-0000-4000-8000-0000000000d2", name: "خالد سلهب" });
  });

  it("explains a bad number in Arabic, on the field", async () => {
    const res = await call({ slot: "primary", license_number: "2-45678" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_license");
    expect(body.fields.license_number).toContain("مهنة صحّية أخرى");
  });

  it("treats a Palestinian licence as unverifiable, not as missing", async () => {
    doctor = { ...DOCTOR, license_region: "PS", license_number: "44/2" };
    const body = await (await call({ slot: "primary", license_number: "44/2", region: "PS" })).json();
    expect(body.checkable).toBe(false);
    expect(body.explanation.code).toBe("not_found_ps");
    expect(body.explanation.headline).toContain("لم يُفحص");
  });

  it("answers 503 on a registry outage rather than calling the number missing", async () => {
    liveThrows = true;
    const res = await call({ slot: "primary", license_number: "189371" });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("moh_unavailable");
  });

  it("404s for a doctor that does not exist", async () => {
    doctor = null;
    expect((await call({ slot: "primary", license_number: "189371" })).status).toBe(404);
  });

  it("rejects a body it cannot read", async () => {
    expect((await call({ slot: "third", license_number: "1" })).status).toBe(400);
  });
});
