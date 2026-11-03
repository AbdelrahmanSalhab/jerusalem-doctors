// Session helpers: who counts as signed in, where everyone else is sent, and
// that the dev shim can never activate in production.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth, db } from "@/test/fakeSupabase";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});
vi.mock("@/lib/supabase/server", async () => {
  const { auth } = await import("@/test/fakeSupabase");
  return { createSupabaseServerClient: async () => ({ auth }) };
});

const session = () => import("./session");
const signedIn = (id = "u1") =>
  auth.getClaims.mockResolvedValue({ data: { claims: { sub: id } }, error: null });

describe("lib/auth/session", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    auth.getClaims.mockResolvedValue({ data: null, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("getCurrentAdmin and the second factor (#164)", () => {
    const sessionOf = (aal: string, ...methods: string[]) =>
      auth.getClaims.mockResolvedValue({ data: { claims: { sub: "u1", aal, amr: methods.map((method) => ({ method })) } }, error: null });
    const admin = { id: "d1", is_admin: true, is_active: true };

    it("lets a password admin in while the flag is off", async () => {
      sessionOf("aal1", "password");
      db.queue("doctors", { data: admin });
      expect(await (await session()).getCurrentAdmin()).toEqual(admin);
    });

    it("turns away a password admin who has not passed the challenge, as not an admin", async () => {
      vi.stubEnv("ADMIN_MFA", "1");
      sessionOf("aal1", "password");
      db.queue("doctors", { data: admin });
      expect(await (await session()).getCurrentAdmin()).toBeNull();
    });

    it("lets the same admin in after the challenge", async () => {
      vi.stubEnv("ADMIN_MFA", "1");
      sessionOf("aal2", "password", "totp");
      db.queue("doctors", { data: admin });
      expect(await (await session()).getCurrentAdmin()).toEqual(admin);
    });

    it("does not ask an admin who signed in by phone code", async () => {
      vi.stubEnv("ADMIN_MFA", "1");
      sessionOf("aal1", "otp");
      db.queue("doctors", { data: admin });
      expect(await (await session()).getCurrentAdmin()).toEqual(admin);
    });

    it("sends the turned-away session to the code step instead of a 404", async () => {
      vi.stubEnv("ADMIN_MFA", "1");
      sessionOf("aal1", "password");
      db.queue("doctors", { data: admin }, { data: admin });
      await expect((await session()).requireAdmin()).rejects.toThrow("REDIRECT /login/dev?code=1");
    });

    it("says a password session awaits its code only when the flag is on and the code is not given", async () => {
      sessionOf("aal1", "password");
      expect(await (await session()).awaitingSecondFactor()).toBe(false);
      vi.stubEnv("ADMIN_MFA", "1");
      expect(await (await session()).awaitingSecondFactor()).toBe(true);
      sessionOf("aal2", "password", "totp");
      expect(await (await session()).awaitingSecondFactor()).toBe(false);
    });

    it("leaves the dev shim alone: it has no token to read", async () => {
      vi.stubEnv("ADMIN_MFA", "1");
      vi.stubEnv("USE_DEV_USER", "1");
      vi.stubEnv("DEV_DOCTOR_ID", "d1");
      db.queue("doctors", { data: admin });
      expect(await (await session()).getCurrentAdmin()).toEqual(admin);
      expect(auth.getClaims).not.toHaveBeenCalled();
    });
  });

  describe("getCurrentDoctor", () => {
    it("returns null without a session, never touching the DB", async () => {
      expect(await (await session()).getCurrentDoctor()).toBeNull();
      expect(db.calls).toHaveLength(0);
    });

    it("looks the doctor up by auth_user_id", async () => {
      signedIn("u9");
      db.queue("doctors", { data: { id: "d1" } });
      expect(await (await session()).getCurrentDoctor()).toEqual({ id: "d1" });
      expect(db.argsOf("doctors", "eq")).toEqual([["auth_user_id", "u9"]]);
    });

    it("returns null for a session with no doctor row", async () => {
      signedIn();
      expect(await (await session()).getCurrentDoctor()).toBeNull();
    });

    it("treats an invalid token as no session", async () => {
      auth.getClaims.mockResolvedValue({ data: null, error: { message: "invalid JWT" } });
      expect(await (await session()).getCurrentDoctor()).toBeNull();
      expect(db.calls).toHaveLength(0);
    });

    it("throws on a DB error", async () => {
      signedIn();
      db.queue("doctors", { error: { message: "boom" } });
      await expect((await session()).getCurrentDoctor()).rejects.toEqual({ message: "boom" });
    });
  });

  describe("dev shim", () => {
    beforeEach(() => {
      vi.stubEnv("USE_DEV_USER", "1");
      vi.stubEnv("DEV_DOCTOR_ID", "dev-1");
    });

    it("returns the dev doctor by id without a session", async () => {
      db.queue("doctors", { data: { id: "dev-1" } });
      expect(await (await session()).getCurrentDoctor()).toEqual({ id: "dev-1" });
      expect(db.argsOf("doctors", "eq")).toEqual([["id", "dev-1"]]);
      expect(auth.getClaims).not.toHaveBeenCalled();
    });

    it("returns null when the dev doctor row is missing", async () => {
      expect(await (await session()).getCurrentDoctor()).toBeNull();
    });

    it("throws on a DB error", async () => {
      db.queue("doctors", { error: { message: "boom" } });
      await expect((await session()).getCurrentDoctor()).rejects.toEqual({ message: "boom" });
    });

    it("stays off without DEV_DOCTOR_ID", async () => {
      vi.stubEnv("DEV_DOCTOR_ID", "");
      expect(await (await session()).getCurrentDoctor()).toBeNull();
      expect(auth.getClaims).toHaveBeenCalled();
    });

    it("is ignored in production, with a warning at load", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.resetModules();
      expect(await (await session()).getCurrentDoctor()).toBeNull();
      expect(auth.getClaims).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("USE_DEV_USER=1"));
      warn.mockRestore();
    });
  });

  describe("requireDoctor", () => {
    it("redirects a visitor to /login", async () => {
      await expect((await session()).requireDoctor()).rejects.toThrow("REDIRECT /login");
    });

    it("redirects an inactive doctor", async () => {
      signedIn();
      db.queue("doctors", { data: { id: "d1", is_active: false } });
      await expect((await session()).requireDoctor()).rejects.toThrow("REDIRECT /login?status=inactive");
    });

    it("returns an active doctor", async () => {
      signedIn();
      db.queue("doctors", { data: { id: "d1", is_active: true } });
      expect(await (await session()).requireDoctor()).toEqual({ id: "d1", is_active: true });
    });
  });

  describe("requireAdmin", () => {
    it("404s a visitor", async () => {
      await expect((await session()).requireAdmin()).rejects.toThrow("NOT_FOUND");
    });

    it("404s a non-admin doctor", async () => {
      signedIn();
      db.queue("doctors", { data: { id: "d1", is_admin: false } });
      await expect((await session()).requireAdmin()).rejects.toThrow("NOT_FOUND");
    });

    it("404s a deactivated admin", async () => {
      signedIn();
      db.queue("doctors", { data: { id: "d1", is_admin: true, is_active: false } });
      await expect((await session()).requireAdmin()).rejects.toThrow("NOT_FOUND");
    });

    it("returns an admin", async () => {
      signedIn();
      db.queue("doctors", { data: { id: "d1", is_admin: true, is_active: true } });
      expect(await (await session()).requireAdmin()).toEqual({ id: "d1", is_admin: true, is_active: true });
    });
  });

  // The API routes' check: null answers 401, a failed lookup must stay an error.
  describe("requireAdminOrNull", () => {
    const check = async () => (await import("./adminApi")).requireAdminOrNull();

    it("is null for a visitor and for a non-admin", async () => {
      expect(await check()).toBeNull();
      signedIn();
      db.queue("doctors", { data: { id: "d1", is_admin: false, is_active: true } });
      expect(await check()).toBeNull();
    });

    it("returns an active admin", async () => {
      signedIn();
      db.queue("doctors", { data: { id: "d1", is_admin: true, is_active: true } });
      expect(await check()).toEqual({ id: "d1", is_admin: true, is_active: true });
    });

    it("throws on a DB error instead of reading as not an admin", async () => {
      signedIn();
      db.queue("doctors", { error: { message: "boom" } });
      await expect(check()).rejects.toEqual({ message: "boom" });
    });
  });

  it("isPhoneAuthDisabled follows its flag", async () => {
    const { isPhoneAuthDisabled } = await session();
    expect(isPhoneAuthDisabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_PHONE_AUTH_DISABLED", "1");
    expect(isPhoneAuthDisabled()).toBe(true);
  });
});
