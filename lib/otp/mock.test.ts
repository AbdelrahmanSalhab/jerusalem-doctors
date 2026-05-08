import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_OTP_CODE, MockOtpProvider } from "./mock";

describe("MockOtpProvider", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts the fixed code 123456", async () => {
    const p = new MockOtpProvider();
    await p.send("+972501234567");
    expect(await p.verify("+972501234567", "123456")).toBe(true);
  });

  it("rejects any other code", async () => {
    const p = new MockOtpProvider();
    expect(await p.verify("+972501234567", "000000")).toBe(false);
    expect(await p.verify("+972501234567", "")).toBe(false);
    expect(await p.verify("+972501234567", "1234567")).toBe(false);
  });

  it("logs the would-be code to stderr (so devs can read it)", async () => {
    const p = new MockOtpProvider();
    await p.send("+972501234567", "whatsapp");
    const err = vi.mocked(console.error);
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0]?.[0]).toContain(MOCK_OTP_CODE);
    expect(err.mock.calls[0]?.[0]).toContain("+972501234567");
    expect(err.mock.calls[0]?.[0]).toContain("whatsapp");
  });

  it("returns a session ref shaped like `mock:<phone>:<ts>`", async () => {
    const p = new MockOtpProvider();
    const r = await p.send("+972501234567");
    expect(r.sessionRef).toMatch(/^mock:\+972501234567:\d+$/);
    expect(r.channel).toBe("whatsapp");
  });

  it("refuses to instantiate in production", () => {
    const orig = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => new MockOtpProvider()).toThrow(/cannot be used in production/);
    } finally {
      vi.stubEnv("NODE_ENV", orig ?? "test");
      vi.unstubAllEnvs();
    }
  });
});
