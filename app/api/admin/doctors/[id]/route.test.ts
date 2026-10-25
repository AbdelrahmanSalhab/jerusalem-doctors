import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Record<string, unknown>[] = [];
const audits: Record<string, unknown>[] = [];

/** The licence status the doctor being patched currently has. */
let licenseStatus: string | null = "verified";
let doctorExists = true;

const { requireAdminOrNull } = vi.hoisted(() => ({
  requireAdminOrNull: vi.fn(async (): Promise<{ id: string } | null> => ({ id: "00000000-0000-4000-8000-00000000a001" })),
}));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
// The dashboard's cache is cleared after an update; there is no request
// scope for revalidateTag here.
const directoryChanged = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cachedReads", () => ({ directoryChanged }));

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

async function call(body: unknown, id = "00000000-0000-4000-8000-0000000000d1") {
  const { PATCH } = await import("./route");
  return PATCH(
    new Request("https://example.test/api/admin/doctors/d1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
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
    // Every dashboard shows the new featured doctor at once.
    expect(directoryChanged).toHaveBeenCalled();
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
    // What reaches the database: the update goes as JSON, which leaves out
    // the fields the body didn't name.
    const sent = JSON.parse(JSON.stringify(updates[0]));
    expect(sent).toEqual({ is_active: false });
    expect(sent).not.toHaveProperty("is_visible");
    expect(sent).not.toHaveProperty("is_admin_approved");
  });
});

describe("PATCH /api/admin/doctors/[id]: who and which", () => {
  it("answers 404 for a malformed id instead of failing the read", async () => {
    expect((await call({ is_visible: false }, "abc")).status).toBe(404);
    expect(updates).toEqual([]);
  });

  it("answers 401 to a non-admin", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await call({ is_visible: false })).status).toBe(401);
  });

  it("answers 500, not 401, when the admin lookup itself fails", async () => {
    requireAdminOrNull.mockRejectedValueOnce(new Error("db down"));
    expect((await call({ is_visible: false })).status).toBe(500);
  });
});
