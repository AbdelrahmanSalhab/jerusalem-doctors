// A super admin removes another admin's authenticator; nobody else can, and
// the route does not say it exists to them.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminOrNull = vi.hoisted(() => vi.fn());
const isSuperAdmin = vi.hoisted(() => vi.fn());
const resetSecondFactor = vi.hoisted(() => vi.fn());
const writeAudit = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ allowed: true }));
const target = vi.hoisted(() => ({ value: { data: null, error: null } as { data: unknown; error: unknown } }));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/auth/superAdmin", () => ({ isSuperAdmin }));
vi.mock("@/lib/auth/mfaReset", () => ({ resetSecondFactor }));
vi.mock("@/lib/audit", () => ({ writeAudit }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: gate.allowed })) }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ marker: "service", from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => target.value }) }) }) }),
}));

const ID = "00000000-0000-4000-8000-0000000000b2";
const call = async (id = ID) =>
  (await import("./route")).POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  gate.allowed = true;
  requireAdminOrNull.mockResolvedValue({ id: "a1", auth_user_id: "ua1" });
  isSuperAdmin.mockResolvedValue(true);
  resetSecondFactor.mockResolvedValue(1);
  target.value = { data: { id: ID, is_admin: true, auth_user_id: "ub2" }, error: null };
});

describe("POST /api/admin/doctors/[id]/mfa/reset", () => {
  it("removes the authenticator and records who did it to whom", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(resetSecondFactor).toHaveBeenCalledWith(expect.anything(), "ub2");
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), { actor_doctor_id: "a1", action: "admin_mfa_reset", target_doctor_id: ID, metadata: { factors: 1 } });
  });

  it("is 401 for a visitor and 404 for an admin who is not a super admin", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(401);
    isSuperAdmin.mockResolvedValueOnce(false);
    expect((await call()).status).toBe(404);
    expect(resetSecondFactor).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    gate.allowed = false;
    expect((await call()).status).toBe(429);
  });

  it("will not reset oneself, a bad id, a doctor who is not an admin, or one that is not there", async () => {
    expect((await call("a1")).status).toBe(404);
    requireAdminOrNull.mockResolvedValueOnce({ id: ID, auth_user_id: "ua1" });
    expect((await call()).status).toBe(404);
    target.value = { data: { id: ID, is_admin: false, auth_user_id: "x" }, error: null };
    expect((await call()).status).toBe(404);
    target.value = { data: { id: ID, is_admin: true, auth_user_id: null }, error: null };
    expect((await call()).status).toBe(404);
    target.value = { data: null, error: null };
    expect((await call()).status).toBe(404);
    expect(resetSecondFactor).not.toHaveBeenCalled();
  });

  it("answers 500 when the doctor cannot be read or the reset fails, recording nothing", async () => {
    target.value = { data: null, error: new Error("db") };
    expect((await call()).status).toBe(500);
    target.value = { data: { id: ID, is_admin: true, auth_user_id: "ub2" }, error: null };
    resetSecondFactor.mockRejectedValueOnce(new Error("auth"));
    expect((await call()).status).toBe(500);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
