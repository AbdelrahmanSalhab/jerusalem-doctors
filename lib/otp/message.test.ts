import { describe, expect, it } from "vitest";
import { MAX_SEGMENT_CHARS, buildOtpMessage, originHostFromEnv } from "./message";

describe("buildOtpMessage", () => {
  it("includes the code", () => {
    expect(buildOtpMessage("123456")).toContain("123456");
  });

  it("starts with the code, so phones offer it", () => {
    expect(buildOtpMessage("482913").startsWith("482913 ")).toBe(true);
  });

  it("preserves a leading zero in the code", () => {
    expect(buildOtpMessage("012345")).toContain("012345");
  });

  // Guards the billing assumption documented in message.ts: Arabic is UCS-2,
  // so anything over 70 characters costs two segments on every single login.
  it("fits in one UCS-2 segment", () => {
    expect(buildOtpMessage("123456").length).toBeLessThanOrEqual(
      MAX_SEGMENT_CHARS,
    );
  });

  describe("with the domain-bound line", () => {
    const host = "jerusalem-doctors.vercel.app";

    it("ends with @host #code on its own last line, and still starts with the code", () => {
      const m = buildOtpMessage("482913", host);
      expect(m.startsWith("482913 ")).toBe(true);
      expect(m.split("\n").at(-1)).toBe(`@${host} #482913`);
    });

    it("fits in one UCS-2 segment, even with a leading zero", () => {
      expect(buildOtpMessage("012345", host).length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS);
    });
  });
});

describe("originHostFromEnv", () => {
  it("is off unless SMS_DOMAIN_LINE is 1", () => {
    expect(originHostFromEnv({ VERCEL_PROJECT_PRODUCTION_URL: "a.example" })).toBeUndefined();
    expect(originHostFromEnv({ SMS_DOMAIN_LINE: "0", SMS_ORIGIN_HOST: "a.example" })).toBeUndefined();
  });

  it("uses the explicit host, else Vercel's production address", () => {
    expect(originHostFromEnv({ SMS_DOMAIN_LINE: "1", SMS_ORIGIN_HOST: "b.example", VERCEL_PROJECT_PRODUCTION_URL: "a.example" })).toBe("b.example");
    expect(originHostFromEnv({ SMS_DOMAIN_LINE: "1", VERCEL_PROJECT_PRODUCTION_URL: "a.example" })).toBe("a.example");
    expect(originHostFromEnv({ SMS_DOMAIN_LINE: "1" })).toBeUndefined();
  });
});
