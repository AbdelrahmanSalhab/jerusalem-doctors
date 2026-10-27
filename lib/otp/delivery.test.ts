import { describe, expect, it } from "vitest";
import { deliveryDelaySeconds, deliveryKey, deliveryUrl, newMessageId, validDeliveryKey } from "./delivery";

describe("delivery reports", () => {
  it("accepts only the key made from the hook's secret", () => {
    expect(validDeliveryKey(deliveryKey("s"), "s")).toBe(true);
    expect(validDeliveryKey(deliveryKey("other"), "s")).toBe(false);
    expect(validDeliveryKey(null, "s")).toBe(false);
    expect(validDeliveryKey(deliveryKey("s"), undefined)).toBe(false);
    expect(deliveryKey("s")).not.toContain("s".repeat(2));
  });

  it("asks for reports in production, or where a base is given, never without the secret", () => {
    const secret = { SEND_SMS_HOOK_SECRET: "s" };
    expect(deliveryUrl({ ...secret, VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "jd.example" })).toBe(
      `https://jd.example/api/sms/delivery?k=${deliveryKey("s")}`,
    );
    expect(deliveryUrl({ ...secret, VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "jd.example" })).toBeNull();
    expect(deliveryUrl({ ...secret, SMS_DELIVERY_BASE_URL: "http://localhost:3123" })).toMatch(/^http:\/\/localhost:3123\/api\/sms\/delivery\?k=/);
    expect(deliveryUrl({ SMS_DELIVERY_BASE_URL: "http://localhost:3123" })).toBeNull();
  });

  it("reads the delay back from our message id", () => {
    const now = 1_800_000_000_000;
    expect(deliveryDelaySeconds(newMessageId(now - 42_400), now)).toBe(42);
    expect(deliveryDelaySeconds("not-ours", now)).toBeNull();
    expect(deliveryDelaySeconds(null, now)).toBeNull();
    // A send time in the future isn't ours either.
    expect(deliveryDelaySeconds(newMessageId(now + 5_000), now)).toBeNull();
  });
});
