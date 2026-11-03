// The admin second factor: asked only of a session that began with a password,
// only while ADMIN_MFA is on, and satisfied only by the TOTP challenge.

import { describe, expect, it } from "vitest";
import { needsSecondFactor } from "./mfa";

const ON = { ADMIN_MFA: "1" };
const claims = (aal: string, ...methods: string[]) => ({ sub: "u1", aal, amr: methods.map((method) => ({ method })) });

describe("needsSecondFactor", () => {
  it("is never asked while the flag is off, so nobody is locked out before enrolling", () => {
    expect(needsSecondFactor(claims("aal1", "password"), {})).toBe(false);
    expect(needsSecondFactor(claims("aal1", "password"), { ADMIN_MFA: "0" })).toBe(false);
  });

  it("asks a password session that has not passed the challenge", () => {
    expect(needsSecondFactor(claims("aal1", "password"), ON)).toBe(true);
  });

  it("lets a password session through once the TOTP challenge raised it to aal2", () => {
    expect(needsSecondFactor(claims("aal2", "password", "totp"), ON)).toBe(false);
  });

  it("does not ask a session that has no password in its history: a phone code, or the smoke check's own link", () => {
    expect(needsSecondFactor(claims("aal1", "otp"), ON)).toBe(false);
    expect(needsSecondFactor(claims("aal1", "magiclink"), ON)).toBe(false);
    expect(needsSecondFactor(claims("aal1"), ON)).toBe(false);
  });

  it("does not ask when there is no session to ask about", () => {
    expect(needsSecondFactor(undefined, ON)).toBe(false);
    expect(needsSecondFactor(null, ON)).toBe(false);
    expect(needsSecondFactor({ sub: "u1" }, ON)).toBe(false);
  });

  it("reads the real environment by default", () => {
    expect(needsSecondFactor(claims("aal1", "password"))).toBe(false);
  });
});
