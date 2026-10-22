import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { PRIVATE_DATA_COLLECTION, scrubBreadcrumb, scrubEvent, scrubPii, scrubSpan, scrubString } from "./sentryScrub";

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
    expect(scrubSpan(span)).toEqual({ name: "GET /admin", attributes: { "url.full": "https://x.test/admin", "http.request.header.cookie": "[Filtered]" } });
  });
});

describe("what the SDK may collect", () => {
  it("closes every category Sentry 11 would otherwise collect, keeping only harmless headers", () => {
    expect(PRIVATE_DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent", "content-type", "accept"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    });
  });
});

describe("gaps an independent review found", () => {
  it("masks phones in percent-encoded lists and in Arabic-Indic digits", () => {
    expect(scrubString("phone_e164=in.%28%2B972501234567%2C%2B972521112233%29")).toBe("phone_e164=in.%28[phone]%2C[phone]%29");
    expect(scrubString("%22q%22%3A%220521234567%22")).toBe("%22q%22%3A%22[phone]%22");
    expect(scrubString("رقمي ٠٥٢١٢٣٤٥٦٧")).toBe("رقمي [phone]");
  });

  it("drops the values a console call logged, keeping its message line", () => {
    const crumb = scrubBreadcrumb({
      category: "console",
      message: "[audit] write failed Error: duplicate key",
      data: { logger: "console", arguments: ["[audit] write failed", { details: "Failing row contains (إياس سلهب, 200001)" }] },
    });
    expect(crumb.data).toEqual({ logger: "console", arguments: undefined });
    expect(JSON.stringify(crumb)).not.toContain("إياس");
  });

  it("strips the query from URL fields and names of Next's own spans", () => {
    const span = scrubSpan({
      name: "fetch GET https://db.test/rest/v1/doctors?license_number=in.(200001)",
      attributes: { "http.target": "/report?license=200001", "http.url": "https://db.test/rest/v1/x?name=eq.Iyas", "http.route": "/report" },
    });
    expect(span).toEqual({
      name: "fetch GET https://db.test/rest/v1/doctors",
      attributes: { "http.target": "/report", "http.url": "https://db.test/rest/v1/x", "http.route": "/report" },
    });
  });

  it("fails closed: a span it cannot scrub goes out with nothing in it", () => {
    const span = { name: "x", attributes: {} };
    Object.defineProperty(span, "attributes", { get: () => { throw new Error("boom"); } });
    expect(scrubSpan(span)).toEqual({ name: "[unscrubbable span]", attributes: {} });
  });

  it("keeps an error's message and stack, scrubbed, and survives circular objects", () => {
    const err = new Error("send to 0521234567 failed");
    expect(scrubPii({ err })).toEqual({ err: { name: "Error", message: "send to [phone] failed", stack: expect.stringContaining("[phone]") } });
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(scrubPii(loop)).toEqual({ a: 1, self: "[Circular]" });
  });
});

describe("gaps a second review found", () => {
  it("keeps the attribute but drops the value in element selectors (a photo's alt is a doctor's name)", () => {
    expect(scrubString('div.card > img.h-[72px].rounded-full[alt="إياس سلهب"]')).toBe("div.card > img.h-[72px].rounded-full[alt]");
    expect(scrubString('body > h1[title="Iyas"] > button[aria-label="اتصل بـ إياس"][type="button"]')).toBe(
      'body > h1[title] > button[aria-label][type="button"]',
    );
    const crumb = scrubBreadcrumb({ category: "ui.click", message: 'img[alt="إياس سلهب"]' });
    expect(crumb.message).toBe("img[alt]");
  });

  it("sends only the code of a captured plain object, such as a supabase-js error", () => {
    const event = scrubEvent({
      exception: { values: [{ type: "Error", value: "Object captured as exception with keys: code, details, hint, message" }] },
      extra: { __serialized__: { code: "23505", details: "Key (license_number)=(200001) already exists.", message: "duplicate key", hint: null }, route: "/api/x" },
    } as unknown as ErrorEvent);
    expect(event.extra).toEqual({ __serialized__: { code: "23505" }, route: "/api/x" });
    expect(scrubPii({ details: "Failing row contains (إياس)", hint: "x" })).toEqual({ details: "[Filtered]", hint: "[Filtered]" });
  });

  it("masks more phone formats: 00972, dots, brackets, and landlines", () => {
    for (const phone of ["00972501234567", "050.123.4567", "(050) 123-4567", "02-6271234", "04 627 1234", "+972 2 627 1234"]) {
      expect(scrubString(`call ${phone} now`), phone).toBe("call [phone] now");
    }
    expect(scrubString("0521234567x")).toBe("[phone]x");
    // Still left alone: ids, licences, statuses, timestamps.
    expect(scrubString("license 1-189371, status 404, at 1792670172")).toBe("license 1-189371, status 404, at 1792670172");
  });

  it("strips the query from the span's segment name too", () => {
    const span = scrubSpan({ name: "GET /admin?q=Iyas", attributes: { "sentry.segment.name": "GET /admin?q=Iyas" } });
    expect(span).toEqual({ name: "GET /admin", attributes: { "sentry.segment.name": "GET /admin" } });
  });
});
