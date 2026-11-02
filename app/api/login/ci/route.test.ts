// The smoke account's door: shut unless configured, and open only to a token
// GitHub issued to our workflow, once.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest } from "@/test/fakeSupabase";

const verifySmokeToken = vi.hoisted(() => vi.fn());
const rateLimit = vi.hoisted(() => vi.fn());
const generateLink = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/githubOidc", () => ({ verifySmokeToken }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
const writeAudit = vi.hoisted(() => vi.fn());
const verifyOtp = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const doctorRow = vi.hoisted(() => ({ data: { id: "d1", is_active: true } as { id: string; is_active: boolean } | null }));
vi.mock("@/lib/audit", () => ({ writeAudit }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { verifyOtp, signOut } }) }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    auth: { admin: { generateLink } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => doctorRow }) }) }),
  }),
}));

const TOKEN = "t".repeat(30);
const call = async (body: unknown = { token: TOKEN }) => (await import("./route")).POST(jsonRequest("/api/login/ci", body));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CI_LOGIN_EMAIL", "ci@example.invalid");
  rateLimit.mockResolvedValue({ success: true });
  verifySmokeToken.mockResolvedValue({ jti: "j1", repository: "org/repo", run_id: "77" });
  generateLink.mockResolvedValue({ data: { properties: { hashed_token: "h" } }, error: null });
  verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  doctorRow.data = { id: "d1", is_active: true };
});

describe("POST /api/login/ci", () => {
  it("does not exist unless an account is configured", async () => {
    vi.stubEnv("CI_LOGIN_EMAIL", "");
    expect((await call()).status).toBe(404);
    expect(verifySmokeToken).not.toHaveBeenCalled();
  });

  it("limits by address before any token checking", async () => {
    rateLimit.mockResolvedValueOnce({ success: false });
    expect((await call()).status).toBe(429);
    expect(verifySmokeToken).not.toHaveBeenCalled();
  });

  it("gives one answer for a malformed body and a token GitHub did not issue", async () => {
    const bad = await call({ token: "short" });
    verifySmokeToken.mockResolvedValueOnce(null);
    const forged = await call();
    expect([bad.status, forged.status]).toEqual([401, 401]);
    expect(await bad.json()).toEqual(await forged.json());
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("refuses a token already used", async () => {
    rateLimit.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
    expect((await call()).status).toBe(401);
    expect(rateLimit).toHaveBeenLastCalledWith("ciLoginToken", "jti:j1");
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("signs in the CI account and writes down which workflow run did it", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ci_login", metadata: expect.objectContaining({ ci_run: "https://github.com/org/repo/actions/runs/77" }) }));
  });

  it("closes the session again when the account is not an active doctor", async () => {
    doctorRow.data = { id: "d1", is_active: false };
    expect((await call()).status).toBe(401);
    expect(signOut).toHaveBeenCalled();
    doctorRow.data = null;
    expect((await call()).status).toBe(401);
  });

  it("fails loudly when Supabase gives no link or no user", async () => {
    generateLink.mockResolvedValueOnce({ data: { properties: null }, error: null });
    expect((await call()).status).toBe(500);
    generateLink.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    expect((await call()).status).toBe(500);
    verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await call()).status).toBe(500);
    verifyOtp.mockResolvedValueOnce({ data: {}, error: new Error("bad") });
    expect((await call()).status).toBe(500);
  });

  it("treats a body that is not JSON as a refusal", async () => {
    const req = new Request("http://x/api/login/ci", { method: "POST", body: "not json" });
    expect((await (await import("./route")).POST(req)).status).toBe(401);
  });
});
