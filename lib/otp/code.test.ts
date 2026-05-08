import { describe, expect, it } from "vitest";
import { generateOtpCode, hashOtpCode, verifyOtpHash } from "./code";

describe("generateOtpCode", () => {
  it("returns six ASCII digits", () => {
    for (let i = 0; i < 50; i++) {
      const c = generateOtpCode();
      expect(c).toMatch(/^\d{6}$/);
    }
  });

  it("preserves leading zeros (000123 not 123)", () => {
    const samples = Array.from({ length: 200 }, () => generateOtpCode());
    expect(samples.every((s) => s.length === 6)).toBe(true);
  });
});

describe("hashOtpCode + verifyOtpHash", () => {
  it("verifies the same code", async () => {
    const h = await hashOtpCode("123456");
    expect(await verifyOtpHash("123456", h)).toBe(true);
  });

  it("rejects wrong codes", async () => {
    const h = await hashOtpCode("123456");
    expect(await verifyOtpHash("000000", h)).toBe(false);
    expect(await verifyOtpHash("", h)).toBe(false);
  });

  it("rejects empty hash", async () => {
    expect(await verifyOtpHash("123456", "")).toBe(false);
  });

  it("hash is non-deterministic (bcrypt salt)", async () => {
    const a = await hashOtpCode("123456");
    const b = await hashOtpCode("123456");
    expect(a).not.toBe(b);
    expect(await verifyOtpHash("123456", a)).toBe(true);
    expect(await verifyOtpHash("123456", b)).toBe(true);
  });
});
