import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Record<string, unknown>[] = [];
const audits: Record<string, unknown>[] = [];

/** The licence status the doctor being patched currently has. */
let licenseStatus: string | null = "verified";
let doctorExists = true;

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1" })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      // The route reads the current licence status before writing, to know
      // whether accepting this doctor needs a reason.
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: doctorExists ? { license_verification_status: licenseStatus } : null,
            error: null,
          }),
        }),
      }),
      update(values: Record<string, unknown>) {
        updates.push(values);
        return { eq: async () => ({ error: null }) };
      },
      insert: async (row: Record<string, unknown>) => {
        if (table === "audit_logs") audits.push(row);
        return { error: null };
      },
    }),
  }),
}));

async function call(body: unknown) {
  const { PATCH } = await import("./route");
  return PATCH(
    new Request("https://example.test/api/admin/doctors/d1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "d1" }) },
  );
}

beforeEach(() => {
  updates.length = 0;
  audits.length = 0;
  licenseStatus = "verified";
  doctorExists = true;
});

describe("PATCH /api/admin/doctors/[id]: featured", () => {
  it("stamps featured_at when featuring", async () => {
    expect((await call({ featured: "graduate" })).status).toBe(200);
    expect(updates[0]).toMatchObject({ featured: "graduate" });
    expect(typeof updates[0].featured_at).toBe("string");
  });

  it("clears featured_at when unfeaturing", async () => {
    expect((await call({ featured: null })).status).toBe(200);
    expect(updates[0]).toEqual({ featured: null, featured_at: null });
  });

  it("leaves featured_at alone for other fields", async () => {
    expect((await call({ is_active: false })).status).toBe(200);
    expect(updates[0]).toEqual({ is_active: false });
  });

  it("rejects an unknown kind", async () => {
    expect((await call({ featured: "vip" })).status).toBe(400);
  });
});

describe("PATCH /api/admin/doctors/[id]: the doctor must exist", () => {
  it("answers 404 rather than writing into nothing", async () => {
    doctorExists = false;
    expect((await call({ is_active: false })).status).toBe(404);
    expect(updates).toEqual([]);
  });
});

describe("PATCH /api/admin/doctors/[id]: accepting a doctor", () => {
  it("needs no reason when the registry confirms the licence", async () => {
    licenseStatus = "verified";
    expect((await call({ is_admin_approved: true })).status).toBe(200);
    expect(updates[0]).toEqual({ is_admin_approved: true });
  });

  it("refuses an unexplained acceptance when the licence is not confirmed", async () => {
    for (const status of ["soft_match", "not_found", "name_mismatch_overridden", null]) {
      licenseStatus = status;
      const res = await call({ is_admin_approved: true });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("approval_reason_required");
    }
    expect(updates).toEqual([]);
  });

  it("accepts with a reason, and keeps it in the log", async () => {
    licenseStatus = "not_found";
    expect((await call({ is_admin_approved: true, approval_reason: "راجعت صورة الشهادة" })).status).toBe(200);
    expect(audits[0]).toMatchObject({
      action: "admin_doctor_updated",
      metadata: {
        is_admin_approved: true,
        approval_reason: "راجعت صورة الشهادة",
        license_status_at_approval: "not_found",
      },
    });
  });

  // approval_reason is not a column; sending it to .update() would fail.
  it("never writes the reason as a column", async () => {
    licenseStatus = "soft_match";
    await call({ is_admin_approved: true, approval_reason: "تحققت هاتفيًا" });
    expect(updates[0]).toEqual({ is_admin_approved: true });
  });

  it("rejects a reason too short to mean anything", async () => {
    licenseStatus = "not_found";
    expect((await call({ is_admin_approved: true, approval_reason: "ok" })).status).toBe(400);
  });

  it("wants no reason for withdrawing acceptance, only for granting it", async () => {
    licenseStatus = "not_found";
    expect((await call({ is_admin_approved: false })).status).toBe(200);
    expect(updates[0]).toEqual({ is_admin_approved: false });
  });

  it("asks for a change to make", async () => {
    expect((await call({ approval_reason: "بدون تغيير" })).status).toBe(400);
  });
});

describe("PATCH /api/admin/doctors/[id]: the three switches", () => {
  it("writes directory visibility, which no screen used to send", async () => {
    expect((await call({ is_visible: false })).status).toBe(200);
    expect(updates[0]).toEqual({ is_visible: false });
  });

  it("keeps the three independent, touching only what was asked", async () => {
    await call({ is_active: false });
    expect(updates[0]).toEqual({ is_active: false });
    expect(updates[0]).not.toHaveProperty("is_visible");
    expect(updates[0]).not.toHaveProperty("is_admin_approved");
  });
});
