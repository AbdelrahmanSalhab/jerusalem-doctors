import { describe, expect, it } from "vitest";
import { JERUSALEM_INSTITUTION_DOMAINS, isInstitutionalEmail, extractDomain } from "./email-allowlist";

describe("extractDomain", () => {
  it("returns lowercased domain", () => {
    expect(extractDomain("Foo@HADASSAH.org.il")).toBe("hadassah.org.il");
  });

  it("returns null for malformed input", () => {
    expect(extractDomain("not-an-email")).toBeNull();
    expect(extractDomain("")).toBeNull();
    expect(extractDomain("a@")).toBeNull();
    expect(extractDomain("@b.com")).toBeNull();
  });
});

describe("isInstitutionalEmail", () => {
  it("matches an exact allowlisted domain", () => {
    expect(isInstitutionalEmail("dr@hadassah.org.il")).toBe(true);
  });

  it("matches a subdomain of an allowlisted domain", () => {
    // Justification: hospital sub-units (nursing.hadassah.org.il) are still
    // implicitly attested by the parent institution's mail infrastructure.
    expect(isInstitutionalEmail("dr@nursing.hadassah.org.il")).toBe(true);
  });

  it("does not match a homoglyph", () => {
    // Cyrillic 'а' (U+0430) instead of Latin 'a'.
    expect(isInstitutionalEmail("dr@hаdassah.org.il")).toBe(false);
  });

  it("does not match a similarly-named non-institutional domain", () => {
    expect(isInstitutionalEmail("dr@hadassah-fan.com")).toBe(false);
    expect(isInstitutionalEmail("dr@my-hadassah.org.il")).toBe(false);
  });

  it("returns false for gmail-style providers", () => {
    expect(isInstitutionalEmail("dr@gmail.com")).toBe(false);
    expect(isInstitutionalEmail("dr@walla.co.il")).toBe(false);
  });

  it("returns false for empty / malformed input", () => {
    expect(isInstitutionalEmail("")).toBe(false);
    expect(isInstitutionalEmail("garbage")).toBe(false);
  });

  it("exposes the seed list", () => {
    expect(JERUSALEM_INSTITUTION_DOMAINS).toContain("hadassah.org.il");
    expect(JERUSALEM_INSTITUTION_DOMAINS).toContain("szmc.org.il");
  });
});
