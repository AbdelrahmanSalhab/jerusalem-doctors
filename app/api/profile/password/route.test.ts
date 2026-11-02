// An admin changes their password: admins only, the old one proved first.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest } from "@/test/fakeSupabase";

const requireDoctor = vi.hoisted(() => vi.fn());
const rateLimit = vi.hoisted(() => vi.fn());
const signInWithPassword = vi.hoisted(() => vi.fn());
const updateUserById = vi.hoisted(() => vi.fn());
const getUserById = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword, signOut: vi.fn() } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ auth: { admin: { getUserById, updateUserById, signOut: vi.fn() } } }),
}));

const NEXT = "a-long-new-passphrase-1";
const call = async (body: unknown = { current: "old-password", next: NEXT }) =>
  (await import("./route")).POST(jsonRequest("/api/profile/password", body));

beforeEach(() => {
  vi.clearAllMocks();
  requireDoctor.mockResolvedValue({ id: "d1", is_admin: true, auth_user_id: "u1" });
  rateLimit.mockResolvedValue({ success: true });
  getUserById.mockResolvedValue({ data: { user: { email: "a@example.com" } } });
  signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
  updateUserById.mockResolvedValue({ error: null });
});

describe("POST /api/profile/password", () => {
  it("is for admins only", async () => {
    requireDoctor.mockResolvedValueOnce({ id: "d2", is_admin: false, auth_user_id: "u2" });
    expect((await call()).status).toBe(401);
    requireDoctor.mockRejectedValueOnce(new Error("no session"));
    expect((await call()).status).toBe(401);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("wants a new password of at least 16 characters, and a different one", async () => {
    expect((await call({ current: "old-password", next: "short" })).status).toBe(400);
    expect((await call({ current: NEXT, next: NEXT })).status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("checks the current password first, so a stolen session cannot lock the owner out", async () => {
    signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error: { message: "bad" } });
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("wrong_password");
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("stops at the rate limit", async () => {
    rateLimit.mockResolvedValueOnce({ success: false });
    expect((await call()).status).toBe(429);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("changes the password when all of it holds", async () => {
    expect((await call()).status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith("u1", { password: NEXT });
  });
});
