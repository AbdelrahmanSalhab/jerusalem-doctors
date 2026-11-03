// Who may reset another admin's authenticator: the addresses on the list, and
// only them.

import { afterEach, describe, expect, it, vi } from "vitest";
import { isSuperAdmin, superAdminEmails } from "./superAdmin";

const service = (email: string | undefined) =>
  ({ auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: email === undefined ? null : { email } } })) } } }) as never;

afterEach(() => vi.unstubAllEnvs());

describe("superAdminEmails", () => {
  it("reads a list of addresses, lowercased, ignoring anything that is not one", () => {
    expect(superAdminEmails("A@x.com, b@y.org  junk\nc@z.io")).toEqual(["a@x.com", "b@y.org", "c@z.io"]);
    expect(superAdminEmails(undefined)).toEqual([]);
    expect(superAdminEmails("")).toEqual([]);
  });
});

describe("isSuperAdmin", () => {
  it("is true only for a sign-in address on the list, whatever its case", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "boss@x.com");
    expect(await isSuperAdmin(service("Boss@X.com"), "u1")).toBe(true);
    expect(await isSuperAdmin(service("other@x.com"), "u1")).toBe(false);
    expect(await isSuperAdmin(service(undefined), "u1")).toBe(false);
  });

  it("is false with no list, or an account with no sign-in of its own", async () => {
    expect(await isSuperAdmin(service("boss@x.com"), "u1")).toBe(false);
    vi.stubEnv("SUPER_ADMIN_EMAILS", "boss@x.com");
    expect(await isSuperAdmin(service("boss@x.com"), null)).toBe(false);
  });
});
