import { describe, expect, it } from "vitest";
import { devLoginEmails, devLoginEnabled, isAllowedDevEmail } from "./devLogin";

describe("devLoginEmails", () => {
  it("reads a comma or space separated list, lowercased", () => {
    expect(devLoginEmails("Dev@Example.com, qa@example.com")).toEqual(["dev@example.com", "qa@example.com"]);
    expect(devLoginEmails("a@b.co\n c@d.co")).toEqual(["a@b.co", "c@d.co"]);
  });

  it("ignores anything that is not an address", () => {
    expect(devLoginEmails("dev@example.com, , notanemail")).toEqual(["dev@example.com"]);
    expect(devLoginEmails("")).toEqual([]);
    expect(devLoginEmails(undefined)).toEqual([]);
  });
});

describe("devLoginEnabled", () => {
  it("needs the flag", () => {
    expect(devLoginEnabled({ DEV_LOGIN_EMAILS: "dev@example.com" })).toBe(false);
    expect(devLoginEnabled({ DEV_LOGIN: "0", DEV_LOGIN_EMAILS: "dev@example.com" })).toBe(false);
  });

  // A flag with no allowlist would otherwise mean "anyone Supabase will
  // authenticate", which is the opposite of the intent.
  it("needs a non-empty allowlist, so half a configuration is shut, not open", () => {
    expect(devLoginEnabled({ DEV_LOGIN: "1" })).toBe(false);
    expect(devLoginEnabled({ DEV_LOGIN: "1", DEV_LOGIN_EMAILS: "" })).toBe(false);
    expect(devLoginEnabled({ DEV_LOGIN: "1", DEV_LOGIN_EMAILS: "nonsense" })).toBe(false);
  });

  it("is on only with both", () => {
    expect(devLoginEnabled({ DEV_LOGIN: "1", DEV_LOGIN_EMAILS: "dev@example.com" })).toBe(true);
  });
});

describe("isAllowedDevEmail", () => {
  const list = ["dev@example.com", "qa@example.com"];

  it("matches regardless of case or padding", () => {
    expect(isAllowedDevEmail("DEV@example.com", list)).toBe(true);
    expect(isAllowedDevEmail("  qa@example.com  ", list)).toBe(true);
  });

  it("refuses anything not listed", () => {
    expect(isAllowedDevEmail("someone@example.com", list)).toBe(false);
    expect(isAllowedDevEmail("", list)).toBe(false);
    // No sub-address or domain wildcards: an allowlist is exact.
    expect(isAllowedDevEmail("dev+1@example.com", list)).toBe(false);
    expect(isAllowedDevEmail("dev@example.com.evil.test", list)).toBe(false);
  });

  it("refuses everything when the allowlist is empty", () => {
    expect(isAllowedDevEmail("dev@example.com", [])).toBe(false);
  });
});
