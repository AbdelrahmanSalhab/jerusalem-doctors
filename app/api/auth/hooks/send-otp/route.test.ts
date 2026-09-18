// Regression cover for the Send SMS Hook's HTTP contract.
//
// Supabase rejects a hook response whose Content-Type header is missing
// (`hook_payload_invalid_content_type`) and fails the entire OTP request, so
// /login and /signup break even when the SMS was delivered. These tests pin
// the header on every exit path, not just the happy one.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { OtpProviderError } from "@/lib/otp/provider";
import { signSendSmsHook } from "@/lib/otp/webhook";

const send = vi.fn();

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/otp", async () => {
  const provider = await import("@/lib/otp/provider");
  return {
    getOtpSender: () => ({ name: "test", send }),
    OtpProviderError: provider.OtpProviderError,
  };
});

const SECRET = `v1,whsec_${Buffer.from("test-secret-bytes").toString("base64")}`;

function hookRequest(body: unknown, sign = true): Request {
  const raw = JSON.stringify(body);
  const id = "webhook-id-1";
  const ts = Math.floor(Date.now() / 1000);
  return new Request("https://example.test/api/auth/hooks/send-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": sign
        ? signSendSmsHook(raw, id, ts, SECRET)
        : "v1,not-the-signature",
    },
    body: raw,
  });
}

const PAYLOAD = { user: { phone: "972501234567" }, sms: { otp: "123456" } };

describe("send-otp hook route", () => {
  beforeEach(() => {
    vi.stubEnv("SEND_SMS_HOOK_SECRET", SECRET);
    send.mockReset();
    send.mockResolvedValue({ messageRef: "test:1" });
  });

  it("answers 200 with a JSON content type on a delivered code", async () => {
    const { POST } = await import("./route");
    const res = await POST(hookRequest(PAYLOAD));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(send).toHaveBeenCalledWith("+972501234567", "123456");
  });

  it("sets a JSON content type on a rejected signature", async () => {
    const { POST } = await import("./route");
    const res = await POST(hookRequest(PAYLOAD, false));

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(send).not.toHaveBeenCalled();
  });

  it("sets a JSON content type on a malformed payload", async () => {
    const { POST } = await import("./route");
    const res = await POST(hookRequest({ user: { phone: "972501234567" } }));

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("answers 400 without retry on a permanent provider failure", async () => {
    send.mockRejectedValue(new OtpProviderError("bad sender", true));
    const { POST } = await import("./route");
    const res = await POST(hookRequest(PAYLOAD));

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("answers 500 so Supabase retries a transient provider failure", async () => {
    send.mockRejectedValue(new OtpProviderError("timeout", false));
    const { POST } = await import("./route");
    const res = await POST(hookRequest(PAYLOAD));

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
