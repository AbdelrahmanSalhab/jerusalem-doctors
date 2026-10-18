import { describe, expect, it } from "vitest";
import { toAsciiDigits } from "./digits";

describe("toAsciiDigits", () => {
  it("maps Arabic-Indic digits", () => {
    expect(toAsciiDigits("١٢٣٤٥٦٧٨٩٠")).toBe("1234567890");
  });

  it("maps Eastern Arabic-Indic (Persian/Urdu keyboard) digits", () => {
    expect(toAsciiDigits("۱۲۳۴۵۶۷۸۹۰")).toBe("1234567890");
  });

  it("keeps separators and ASCII digits as they are", () => {
    expect(toAsciiDigits("١-٢٣456")).toBe("1-23456");
    expect(toAsciiDigits("050-1234567")).toBe("050-1234567");
  });

  it("leaves letters alone", () => {
    expect(toAsciiDigits("رقم ١")).toBe("رقم 1");
  });
});
