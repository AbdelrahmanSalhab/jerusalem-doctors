// The smoke account's door: shut unless configured, and open only to a token
// GitHub issued to our workflow, once.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest } from "@/test/fakeSupabase";

const verifySmokeToken = vi.hoisted(() => vi.fn());
const rateLimit = vi.hoisted(() => vi.fn());
const generateLink = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/githubOidc", () => ({ verifySmokeToken }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ auth: { admin: { generateLink } } }) }));

const TOKEN = "t".repeat(30);
const call = async (body: unknown = { token: TOKEN }) => (await import("./route")).POST(jsonRequest("/api/login/ci", body));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CI_LOGIN_EMAIL", "ci@example.invalid");
  rateLimit.mockResolvedValue({ success: true });
  verifySmokeToken.mockResolvedValue({ jti: "j1" });
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
});
