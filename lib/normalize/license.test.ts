import { describe, expect, it } from "vitest";
import {
  isValidLicenseFormat,
  licenseFormatErrorMessage,
} from "./license";

describe("isValidLicenseFormat (IL)", () => {
  it("accepts plain digit strings", () => {
    expect(isValidLicenseFormat("IL", "12345")).toBe(true);
    expect(isValidLicenseFormat("IL", "1")).toBe(true);
  });

  it("accepts up to 12 digits", () => {
    expect(isValidLicenseFormat("IL", "123456789012")).toBe(true);
  });

  it("rejects more than 12 digits", () => {
    expect(isValidLicenseFormat("IL", "1234567890123")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidLicenseFormat("IL", "")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidLicenseFormat("IL", "12a45")).toBe(false);
    expect(isValidLicenseFormat("IL", "12-45")).toBe(false);
    expect(isValidLicenseFormat("IL", "12345 ")).toBe(false);
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

  it("returns a generic invalid message for PS", () => {
    expect(licenseFormatErrorMessage("PS")).toMatch(/غير صالح/);
  });
});
