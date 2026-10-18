// getOtpSender: OTP_PROVIDER picks the sender; production defaults to SMS4FREE.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetOtpSenderForTests, getOtpSender } from "./index";

describe("getOtpSender", () => {
  beforeEach(() => __resetOtpSenderForTests());
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the mock outside production, and caches it", () => {
    vi.stubEnv("OTP_PROVIDER", "");
    vi.stubEnv("OTP_PROVIDER", undefined as unknown as string);
    const sender = getOtpSender();
    expect(sender.name).toBe("mock");
    expect(getOtpSender()).toBe(sender);
  });

  it("defaults to SMS4FREE in production", () => {
    vi.stubEnv("OTP_PROVIDER", undefined as unknown as string);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMS4FREE_KEY", "k");
    vi.stubEnv("SMS4FREE_USER", "u");
    vi.stubEnv("SMS4FREE_PASS", "p");
    vi.stubEnv("SMS4FREE_SENDER", "JDoctors");
    expect(getOtpSender().name).toBe("sms4free");
  });

  it("selects WhatsApp, ignoring case and spaces", () => {
    vi.stubEnv("OTP_PROVIDER", " WhatsApp_Meta ");
    vi.stubEnv("META_PHONE_NUMBER_ID", "pn");
    vi.stubEnv("META_ACCESS_TOKEN", "t");
    vi.stubEnv("META_AUTH_TEMPLATE_NAME", "otp");
    expect(getOtpSender().name).toBe("whatsapp_meta");
  });

  it("rejects an unknown provider", () => {
    vi.stubEnv("OTP_PROVIDER", "carrier-pigeon");
    expect(() => getOtpSender()).toThrow(/Unknown OTP_PROVIDER "carrier-pigeon"/);
  });
});
