import { afterEach, describe, expect, it, vi } from "vitest";
import { refuseAdminTarget } from "./adminTarget";

const ACTOR = { id: "a1", auth_user_id: "u1" };
const service = (email: string | null) =>
  ({
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: email ? { email, email_confirmed_at: "2026-01-01" } : null } }),
      },
    },
  }) as never;

afterEach(() => vi.unstubAllEnvs());

describe("refuseAdminTarget", () => {
  it("lets an admin act on a doctor, or on themselves", async () => {
    expect(await refuseAdminTarget(service(null), ACTOR, { id: "d1", is_admin: false })).toBeNull();
    expect(await refuseAdminTarget(service(null), ACTOR, { id: "d1", is_admin: null })).toBeNull();
    expect(await refuseAdminTarget(service(null), ACTOR, { id: "a1", is_admin: true })).toBeNull();
  });

  it("refuses an admin acting on another admin, with a 403", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "boss@example.test");
    const res = await refuseAdminTarget(service("other@example.test"), ACTOR, { id: "a2", is_admin: true });
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ code: "admin_protected" });
  });

  it("refuses everyone when no super admin is configured", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "");
    expect((await refuseAdminTarget(service("boss@example.test"), ACTOR, { id: "a2", is_admin: true }))?.status).toBe(403);
  });

  it("lets a super admin act on another admin", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "boss@example.test");
    expect(await refuseAdminTarget(service("boss@example.test"), ACTOR, { id: "a2", is_admin: true })).toBeNull();
  });
});
