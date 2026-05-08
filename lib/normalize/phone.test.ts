import { describe, expect, it } from "vitest";
import { InvalidPhoneError, formatPhoneDisplay, normalizePhone } from "./phone";

describe("normalizePhone (Israeli default)", () => {
  it("normalizes Israeli local form 0501234567", () => {
    expect(normalizePhone("0501234567")).toBe("+972501234567");
  });

  it("normalizes plus-prefixed international", () => {
    expect(normalizePhone("+972501234567")).toBe("+972501234567");
  });

  it("normalizes 972 prefix without plus", () => {
    expect(normalizePhone("972501234567")).toBe("+972501234567");
  });

  it("strips internal hyphens", () => {
    expect(normalizePhone("050-123-4567")).toBe("+972501234567");
    expect(normalizePhone("+972-50-123-4567")).toBe("+972501234567");
  });

  it("strips internal whitespace", () => {
    expect(normalizePhone("050 123 4567")).toBe("+972501234567");
    expect(normalizePhone("  050-123-4567  ")).toBe("+972501234567");
  });

  it("strips parentheses and dots", () => {
    expect(normalizePhone("(050) 123.4567")).toBe("+972501234567");
  });

  it("accepts a different Israeli mobile prefix (053)", () => {
    expect(normalizePhone("0531234567")).toBe("+972531234567");
  });

  it("accepts a Palestinian mobile (+970)", () => {
    expect(normalizePhone("+970599123456")).toBe("+970599123456");
  });

  it("accepts a US number when fully qualified", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });

  it("rejects empty strings", () => {
    expect(() => normalizePhone("")).toThrow(InvalidPhoneError);
    expect(() => normalizePhone("   ")).toThrow(InvalidPhoneError);
  });

  it("rejects junk strings", () => {
    expect(() => normalizePhone("hello world")).toThrow(InvalidPhoneError);
  });

  it("rejects too-short numbers", () => {
    expect(() => normalizePhone("0501")).toThrow(InvalidPhoneError);
  });

  it("rejects non-string input gracefully", () => {
    // @ts-expect-error testing runtime behavior
    expect(() => normalizePhone(undefined)).toThrow(InvalidPhoneError);
    // @ts-expect-error testing runtime behavior
    expect(() => normalizePhone(null)).toThrow(InvalidPhoneError);
  });

  it("preserves equivalence: same number, many input forms", () => {
    const variants = [
      "0501234567",
      "+972501234567",
      "972501234567",
      "050-123-4567",
      "(050) 123-4567",
      "  +972 50 123 4567  ",
    ];
    const normalized = variants.map((v) => normalizePhone(v));
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("+972501234567");
  });

  it("is idempotent (normalize twice = normalize once)", () => {
    expect(normalizePhone(normalizePhone("0501234567"))).toBe("+972501234567");
  });
});

describe("formatPhoneDisplay", () => {
  it("formats E.164 to national readable form", () => {
    const out = formatPhoneDisplay("+972501234567");
    // libphonenumber emits "050-123-4567" for IL nationals
    expect(out).toMatch(/050[-\s]?123[-\s]?4567/);
  });

  it("falls back to input on unparseable strings", () => {
    expect(formatPhoneDisplay("not-a-number")).toBe("not-a-number");
  });
});
