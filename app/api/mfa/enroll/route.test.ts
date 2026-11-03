// Starting an authenticator: a QR and a secret, once, and only for an admin.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireDoctor = vi.hoisted(() => vi.fn());
const awaiting = vi.hoisted(() => ({ value: false, window: false }));
const gate = vi.hoisted(() => ({ allowed: true }));
const mfa = vi.hoisted(() => ({ listFactors: vi.fn(), unenroll: vi.fn(), enroll: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireDoctor, awaitingSecondFactor: async () => awaiting.value }));
vi.mock("@/lib/auth/mfaReset", () => ({ enrolWindowOpen: async () => awaiting.window }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: gate.allowed })) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { mfa } }) }));

const call = async () => (await import("./route")).POST(new Request("http://x/api/mfa/enroll", { method: "POST" }));

beforeEach(() => {
  vi.clearAllMocks();
  gate.allowed = true;
  awaiting.value = false;
  awaiting.window = false;
  requireDoctor.mockResolvedValue({ id: "d1", is_admin: true, auth_user_id: "u1" });
  mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null });
  mfa.enroll.mockResolvedValue({ data: { id: "f1", totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "ABC" } }, error: null });
});

describe("POST /api/mfa/enroll", () => {
  it("returns what the app needs to scan", async () => {
    const res = await call();
    expect(await res.json()).toEqual({ factorId: "f1", qr: "data:image/svg+xml;utf8,<svg/>", secret: "ABC" });
    expect(mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: "totp" }));
  });

  it("clears a scan that was never confirmed first", async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [{ id: "old", status: "unverified" }, { id: "x", status: "verified" }] }, error: null });
    await call();
    expect(mfa.unenroll).toHaveBeenCalledTimes(1);
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "old" });
  });

  it("will not replace a working factor", async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: "f0" }], all: [] }, error: null });
    const res = await call();
    expect(res.status).toBe(409);
    expect(mfa.enroll).not.toHaveBeenCalled();
  });

  it("refuses a password session that has not given its code, once the flag is on", async () => {
    awaiting.value = true;
    const res = await call();
    expect(res.status).toBe(403);
    expect(mfa.enroll).not.toHaveBeenCalled();
  });

  it("lets that session enrol while a super admin's reset window is open", async () => {
    awaiting.value = true;
    awaiting.window = true;
    expect((await call()).status).toBe(200);
  });

  it("is for admins only and rate limited", async () => {
    requireDoctor.mockResolvedValueOnce({ id: "d1", is_admin: false });
    expect((await call()).status).toBe(401);
    gate.allowed = false;
    expect((await call()).status).toBe(429);
    expect(mfa.enroll).not.toHaveBeenCalled();
  });

  it("answers 502 when the auth server does not", async () => {
    mfa.listFactors.mockResolvedValueOnce({ data: null, error: new Error("down") });
    expect((await call()).status).toBe(502);
    mfa.enroll.mockResolvedValueOnce({ data: null, error: new Error("down") });
    expect((await call()).status).toBe(502);
  });
});
