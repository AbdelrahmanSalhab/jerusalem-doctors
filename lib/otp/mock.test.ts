import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockOtpSender } from "./mock";

describe("MockOtpSender", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the real code to stderr so devs can read it", async () => {
    const s = new MockOtpSender();
    await s.send("+972501234567", "424242");
    const err = vi.mocked(console.error);
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0]?.[0]).toContain("424242");
    expect(err.mock.calls[0]?.[0]).toContain("+972501234567");
  });

  it("returns a message ref referencing the phone", async () => {
    const s = new MockOtpSender();
    const r = await s.send("+972501234567", "123456");
    expect(r.messageRef).toBe("mock:+972501234567");
  });

  it("refuses to instantiate in production", () => {
    const orig = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => new MockOtpSender()).toThrow(/cannot be used in production/);
    } finally {
      vi.stubEnv("NODE_ENV", orig ?? "test");
      vi.unstubAllEnvs();
    }
  });
});
