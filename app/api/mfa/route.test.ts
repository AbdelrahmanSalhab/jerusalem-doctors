// Where an admin's authenticator stands: set up or not, and whether this
// session is waiting for its code.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireDoctor = vi.hoisted(() => vi.fn());
const mfa = vi.hoisted(() => ({ listFactors: vi.fn(), getAuthenticatorAssuranceLevel: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { mfa } }) }));

const call = async () => (await import("./route")).GET(new Request("http://x/api/mfa"));

beforeEach(() => {
  vi.clearAllMocks();
  requireDoctor.mockResolvedValue({ id: "d1", is_admin: true, auth_user_id: "u1" });
  mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
  mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
});

describe("GET /api/mfa", () => {
  it("says nothing is set up and nothing is waiting", async () => {
    expect(await (await call()).json()).toEqual({ enrolled: false, waiting: false });
  });

  it("says a password session with a factor is waiting for the code", async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: "f1" }] }, error: null });
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    expect(await (await call()).json()).toEqual({ enrolled: true, waiting: true });
  });

  it("does not wait once the code has been given", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    expect((await (await call()).json()).waiting).toBe(false);
  });

  it("is for admins with a sign-in of their own", async () => {
    requireDoctor.mockResolvedValueOnce({ id: "d1", is_admin: false });
    expect((await call()).status).toBe(401);
    requireDoctor.mockRejectedValueOnce(new Error("REDIRECT /login"));
    expect((await call()).status).toBe(401);
  });

  it("says unauthenticated when the auth server no longer knows the session", async () => {
    mfa.listFactors.mockResolvedValue({ data: null, error: Object.assign(new Error("Auth session missing!"), { name: "AuthSessionMissingError" }) });
    expect((await call()).status).toBe(401);
  });

  it("answers 502 when the auth server does not", async () => {
    mfa.listFactors.mockResolvedValue({ data: null, error: new Error("down") });
    expect((await call()).status).toBe(502);
  });
});
