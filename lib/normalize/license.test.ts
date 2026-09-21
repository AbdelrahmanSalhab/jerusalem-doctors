import { describe, expect, it } from "vitest";
import {
  canonicalLicenseNumber,
  isValidLicenseFormat,
  licenseFormatErrorMessage,
  parseIlLicense,
} from "./license";

describe("parseIlLicense", () => {
  it("passes a bare serial through unchanged", () => {
    expect(parseIlLicense("189371")).toEqual({
      ok: true,
      serial: "189371",
      hadProfessionPrefix: false,
    });
  });

  it("strips the registry's displayed profession prefix", () => {
    // registries.health.gov.il shows this doctor as `1-189371`.
    for (const input of ["1-189371", "1 - 189371", "1/189371", "1 / 189371"]) {
      expect(parseIlLicense(input)).toEqual({
        ok: true,
        serial: "189371",
        hadProfessionPrefix: true,
      });
    }
  });

  it("strips the prefix when the hyphen was dropped", () => {
    // 7 digits cannot be a serial, so the leading 1 must be the prefix.
    expect(parseIlLicense("1189371")).toEqual({
      ok: true,
      serial: "189371",
      hadProfessionPrefix: true,
    });
  });

  it("treats leading zeros as padding", () => {
    expect(parseIlLicense("0189371")).toMatchObject({ serial: "189371" });
    expect(parseIlLicense("1-0045678")).toMatchObject({ serial: "45678" });
  });

  it("leaves an ambiguous 6-digit number alone", () => {
    // `145678` is both a plausible `1` + `45678` and a real serial of its
    // own. Only the registry name can tell them apart, so the parser must
    // not guess — see lib/moh/match.ts.
    expect(parseIlLicense("145678")).toEqual({
      ok: true,
      serial: "145678",
      hadProfessionPrefix: false,
    });
  });

  it("rejects other professions' licenses", () => {
    expect(parseIlLicense("2-45678")).toEqual({
      ok: false,
      reason: "wrong_profession",
      professionCode: "2",
    });
    expect(parseIlLicense("2189371")).toEqual({
      ok: false,
      reason: "wrong_profession",
      professionCode: "2",
    });
    expect(parseIlLicense("101-45678")).toMatchObject({
      reason: "wrong_profession",
      professionCode: "101",
    });
  });

  it("rejects numbers too long to read as prefix + serial", () => {
    expect(parseIlLicense("12345678")).toEqual({ ok: false, reason: "too_long" });
    expect(parseIlLicense("1-1234567")).toEqual({ ok: false, reason: "too_long" });
  });

  it("rejects empty and non-numeric input", () => {
    expect(parseIlLicense("")).toEqual({ ok: false, reason: "empty" });
    expect(parseIlLicense("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseIlLicense("1-0")).toEqual({ ok: false, reason: "empty" });
    expect(parseIlLicense("12a45")).toEqual({ ok: false, reason: "not_numeric" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseIlLicense("  1-189371  ")).toMatchObject({ serial: "189371" });
  });
});

describe("canonicalLicenseNumber", () => {
  it("collapses every spelling of an IL license to one value", () => {
    const forms = ["189371", "1-189371", "1189371", "0189371", " 1 - 189371 "];
    for (const f of forms) {
      expect(canonicalLicenseNumber("IL", f)).toBe("189371");
    }
  });

  it("returns null for an unreadable IL license", () => {
    expect(canonicalLicenseNumber("IL", "2-45678")).toBeNull();
    expect(canonicalLicenseNumber("IL", "")).toBeNull();
  });

  it("passes PS licenses through trimmed", () => {
    expect(canonicalLicenseNumber("PS", " 12/345 ")).toBe("12/345");
    expect(canonicalLicenseNumber("PS", "12,345")).toBeNull();
  });
});

describe("isValidLicenseFormat (IL)", () => {
  it("accepts plain digit strings", () => {
    expect(isValidLicenseFormat("IL", "12345")).toBe(true);
    expect(isValidLicenseFormat("IL", "1")).toBe(true);
  });

  it("accepts the registry's prefixed form", () => {
    expect(isValidLicenseFormat("IL", "1-189371")).toBe(true);
    expect(isValidLicenseFormat("IL", "1189371")).toBe(true);
  });

  it("rejects a serial longer than the registry issues", () => {
    expect(isValidLicenseFormat("IL", "123456789012")).toBe(false);
    expect(isValidLicenseFormat("IL", "1234567890123")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidLicenseFormat("IL", "")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidLicenseFormat("IL", "12a45")).toBe(false);
  });

  it("rejects a non-physician profession prefix", () => {
    expect(isValidLicenseFormat("IL", "2-45678")).toBe(false);
  });
});

describe("isValidLicenseFormat (PS)", () => {
  it("accepts plain digit strings", () => {
    expect(isValidLicenseFormat("PS", "12345")).toBe(true);
  });

  it("accepts letters (Arabic and Latin)", () => {
    expect(isValidLicenseFormat("PS", "ABC123")).toBe(true);
    expect(isValidLicenseFormat("PS", "طبيب123")).toBe(true);
  });

  it("accepts hyphen and slash", () => {
    expect(isValidLicenseFormat("PS", "12-345")).toBe(true);
    expect(isValidLicenseFormat("PS", "12/345")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidLicenseFormat("PS", "")).toBe(false);
  });

  it("rejects longer than 20 characters", () => {
    expect(isValidLicenseFormat("PS", "a".repeat(21))).toBe(false);
  });

  it("rejects PostgREST filter-breaking characters", () => {
    // These are load-bearing: app/api/signup/start/route.ts builds a raw
    // PostgREST `.or()` filter string out of license numbers that pass this
    // check. Commas, parens, and dots are structural in that mini-language.
    expect(isValidLicenseFormat("PS", "12,345")).toBe(false);
    expect(isValidLicenseFormat("PS", "12(345)")).toBe(false);
    expect(isValidLicenseFormat("PS", "12.345")).toBe(false);
    expect(isValidLicenseFormat("PS", "12 345")).toBe(false);
  });
});

describe("licenseFormatErrorMessage", () => {
  it("returns a digits-only message for IL", () => {
    expect(licenseFormatErrorMessage("IL")).toMatch(/أرقام/);
  });

  it("names the other profession when the prefix is wrong", () => {
    expect(licenseFormatErrorMessage("IL", "2-45678")).toMatch(/مهنة صحّية أخرى/);
  });

  it("returns a generic invalid message for PS", () => {
    expect(licenseFormatErrorMessage("PS")).toMatch(/غير صالح/);
  });
});
