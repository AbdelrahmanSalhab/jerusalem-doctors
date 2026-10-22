import { describe, expect, it } from "vitest";
import { PRIVATE_DATA_COLLECTION, scrubPii, scrubSpan, scrubString } from "./sentryScrub";

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

  it("keeps names and licence numbers out, so alerts' details stay in the activity log", () => {
    expect(scrubPii({ extra: { flagged: 1, licenses: ["200001"], names: ["إياس سلهب"], arabic_full_name: "x", doctor_ids: ["d1"] } })).toEqual({
      extra: { flagged: 1, licenses: "[Filtered]", names: "[Filtered]", arabic_full_name: "[Filtered]", doctor_ids: ["d1"] },
    });
  });

  it("scrubs spans, whose attributes carry request URLs", () => {
    const span = { name: "GET /admin", attributes: { "url.full": "https://x.test/admin?q=0521234567", "http.request.header.cookie": "sb=1" } };
    expect(scrubSpan(span)).toEqual({ name: "GET /admin", attributes: { "url.full": "https://x.test/admin?q=[phone]", "http.request.header.cookie": "[Filtered]" } });
  });
});

describe("what the SDK may collect", () => {
  it("closes every category Sentry 11 would otherwise collect", () => {
    const flat = JSON.stringify(PRIVATE_DATA_COLLECTION);
    expect(flat).not.toContain("true");
    expect(PRIVATE_DATA_COLLECTION).toMatchObject({ userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false });
    expect(PRIVATE_DATA_COLLECTION.httpHeaders.request.deny).toEqual(expect.arrayContaining(["forwarded", "-ip", "cookie"]));
  });
});
