// The authenticator code: confirming a new factor, or answering the challenge
// of a password sign-in.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireDoctor = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ allowed: true }));
const writeAudit = vi.hoisted(() => vi.fn());
const mfa = vi.hoisted(() => ({ listFactors: vi.fn(), challengeAndVerify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
vi.mock("@/lib/audit", () => ({ writeAudit }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: gate.allowed })) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { mfa } }) }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ marker: "service" }) }));

const FACTOR = "00000000-0000-4000-8000-0000000000f1";
const call = async (body: unknown) =>
  (await import("./route")).POST(new Request("http://x/api/mfa/verify", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  gate.allowed = true;
  requireDoctor.mockResolvedValue({ id: "d1", is_admin: true, auth_user_id: "u1" });
  mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: FACTOR }] }, error: null });
  mfa.challengeAndVerify.mockResolvedValue({ error: null });
});

describe("POST /api/mfa/verify", () => {
  it("answers a sign-in's challenge with the admin's own factor, and records nothing", async () => {
    const res = await call({ code: "123456" });
    expect(res.status).toBe(200);
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: FACTOR, code: "123456" });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("confirms a new factor and records that it was turned on", async () => {
    const other = "00000000-0000-4000-8000-0000000000f2";
    expect((await call({ code: "123456", factorId: other })).status).toBe(200);
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: other, code: "123456" });
    expect(writeAudit).toHaveBeenCalledWith({ marker: "service" }, { actor_doctor_id: "d1", action: "admin_mfa_enrolled", target_doctor_id: "d1" });
  });

  it("refuses a wrong code with one answer", async () => {
    mfa.challengeAndVerify.mockResolvedValue({ error: new Error("invalid") });
    const res = await call({ code: "000000" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("wrong_code");
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a body that is not six digits", async () => {
    for (const code of ["12345", "1234567", "12345a", ""]) expect((await call({ code })).status).toBe(400);
    expect((await (await import("./route")).POST(new Request("http://x", { method: "POST", body: "nope" }))).status).toBe(400);
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("has no factor to answer with when none is set up", async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    expect((await call({ code: "123456" })).status).toBe(400);
    mfa.listFactors.mockResolvedValue({ data: null, error: new Error("down") });
    expect((await call({ code: "123456" })).status).toBe(400);
  });

  it("is for admins only and rate limited", async () => {
    requireDoctor.mockResolvedValueOnce({ id: "d1", is_admin: false });
    expect((await call({ code: "123456" })).status).toBe(401);
    gate.allowed = false;
    expect((await call({ code: "123456" })).status).toBe(429);
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
});
