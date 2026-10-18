import { describe, expect, it } from "vitest";
import { scrubPii, scrubString } from "./sentryScrub";

describe("Sentry scrubbing", () => {
  it("masks phone numbers inside strings and URLs", () => {
    expect(scrubString("GET /rest/v1/doctors?phone_e164=eq.%2B972501234567")).toBe(
      "GET /rest/v1/doctors?phone_e164=eq.[phone]",
    );
    expect(scrubString("send to +972 52-869-7375 failed")).toBe("send to [phone] failed");
    expect(scrubString("local 052-869-7375")).toBe("local [phone]");
    expect(scrubString("license 1-189371, status 404")).toBe("license 1-189371, status 404");
    expect(scrubString("Key (phone_e164)=(+970599123456) exists")).toBe("Key (phone_e164)=([phone]) exists");
  });

  it("leaves ids alone that happen to contain 972", () => {
    const uuid = "5f3c2972-1234-4567-8901-123456789012";
    expect(scrubString(uuid)).toBe(uuid);
    expect(scrubString("99723456789012")).toBe("99723456789012");
  });

  it("replaces values under PII keys, at any depth", () => {
    expect(scrubPii({ a: { phone_e164: "+972501234567", ok: 1 }, list: [{ ip: "1.2.3.4" }] })).toEqual({
      a: { phone_e164: "[Filtered]", ok: 1 },
      list: [{ ip: "[Filtered]" }],
    });
  });
});
