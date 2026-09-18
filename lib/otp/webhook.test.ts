import { describe, expect, it } from "vitest";
import { parseHookSecret, signSendSmsHook, verifySendSmsHook } from "./webhook";

const SECRET = "v1,whsec_dGVzdC1zZWNyZXQtdmFsdWUtZm9yLXVuaXQtdGVzdHM=";
const BODY = JSON.stringify({
  user: { phone: "972501234567" },
  sms: { otp: "123456" },
});
const ID = "msg_2KWPBgLlAfxdpx2AI54pPJ85f4W";
const NOW_MS = 1_700_000_000_000;
const TS = Math.floor(NOW_MS / 1000);

function headers(overrides: Record<string, string | null> = {}): Headers {
  const base: Record<string, string> = {
    "webhook-id": ID,
    "webhook-timestamp": String(TS),
    "webhook-signature": signSendSmsHook(BODY, ID, TS, SECRET),
  };
  const h = new Headers();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v !== null) h.set(k, v);
  }
  return h;
}

describe("parseHookSecret", () => {
  it("accepts v1,whsec_ / whsec_ / bare forms identically", () => {
    const bare = "dGVzdC1zZWNyZXQtdmFsdWUtZm9yLXVuaXQtdGVzdHM=";
    expect(parseHookSecret(`v1,whsec_${bare}`)).toEqual(parseHookSecret(bare));
    expect(parseHookSecret(`whsec_${bare}`)).toEqual(parseHookSecret(bare));
  });
});

describe("verifySendSmsHook", () => {
  it("accepts a correctly signed request", () => {
    expect(verifySendSmsHook(BODY, headers(), SECRET, NOW_MS)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = BODY.replace("123456", "999999");
    expect(verifySendSmsHook(tampered, headers(), SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const other = "v1,whsec_b3RoZXItc2VjcmV0LXZhbHVlLWZvci11bml0LXRlc3Rz";
    const h = headers({ "webhook-signature": signSendSmsHook(BODY, ID, TS, other) });
    expect(verifySendSmsHook(BODY, h, SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a mismatched webhook-id", () => {
    expect(verifySendSmsHook(BODY, headers({ "webhook-id": "msg_other" }), SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const staleTs = TS - 10 * 60;
    const h = headers({
      "webhook-timestamp": String(staleTs),
      "webhook-signature": signSendSmsHook(BODY, ID, staleTs, SECRET),
    });
    expect(verifySendSmsHook(BODY, h, SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a far-future timestamp", () => {
    const futureTs = TS + 10 * 60;
    const h = headers({
      "webhook-timestamp": String(futureTs),
      "webhook-signature": signSendSmsHook(BODY, ID, futureTs, SECRET),
    });
    expect(verifySendSmsHook(BODY, h, SECRET, NOW_MS)).toBe(false);
  });

  it("accepts a timestamp inside the 5 minute tolerance", () => {
    const nearTs = TS - 4 * 60;
    const h = headers({
      "webhook-timestamp": String(nearTs),
      "webhook-signature": signSendSmsHook(BODY, ID, nearTs, SECRET),
    });
    expect(verifySendSmsHook(BODY, h, SECRET, NOW_MS)).toBe(true);
  });

  it("accepts when one of several space-delimited signatures matches", () => {
    const good = signSendSmsHook(BODY, ID, TS, SECRET);
    const h = headers({ "webhook-signature": `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${good}` });
    expect(verifySendSmsHook(BODY, h, SECRET, NOW_MS)).toBe(true);
  });

  it("ignores signature entries with an unknown version prefix", () => {
    const sig = signSendSmsHook(BODY, ID, TS, SECRET).slice(3);
    const h = headers({ "webhook-signature": `v2,${sig}` });
    expect(verifySendSmsHook(BODY, h, SECRET, NOW_MS)).toBe(false);
  });

  it.each(["webhook-id", "webhook-timestamp", "webhook-signature"])(
    "rejects when %s is missing",
    (name) => {
      expect(verifySendSmsHook(BODY, headers({ [name]: null }), SECRET, NOW_MS)).toBe(false);
    },
  );

  it("rejects a non-numeric timestamp", () => {
    expect(verifySendSmsHook(BODY, headers({ "webhook-timestamp": "abc" }), SECRET, NOW_MS)).toBe(false);
  });

  it("rejects an empty secret", () => {
    expect(verifySendSmsHook(BODY, headers(), "", NOW_MS)).toBe(false);
  });

  it("rejects a malformed signature entry with no comma", () => {
    expect(verifySendSmsHook(BODY, headers({ "webhook-signature": "garbage" }), SECRET, NOW_MS)).toBe(false);
  });
});
