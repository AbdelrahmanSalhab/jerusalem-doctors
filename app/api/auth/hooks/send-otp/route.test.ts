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

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage }));

/** Who the database knows: a doctor's phone, or a live signup's. */
const known = { doctor: true, pending: false, error: false };
let budgetLeft = true;
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gt", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () => {
        if (known.error) return { data: null, error: { message: "down" } };
        const hit = table === "doctors" ? known.doctor : known.pending;
        return { data: hit ? { id: "x" } : null, error: null };
      };
      return chain;
    },
  }),
}));
let remaining = 150;
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(async () => ({ success: budgetLeft, limit: 200, remaining })),
}));
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
    Object.assign(known, { doctor: true, pending: false, error: false });
    budgetLeft = true;
    remaining = 150;
    captureMessage.mockClear();
  });

  describe("who gets a code", () => {
    it("sends to a number with a live signup", async () => {
      Object.assign(known, { doctor: false, pending: true });
      const { POST } = await import("./route");
      expect((await POST(hookRequest(PAYLOAD))).status).toBe(200);
      expect(send).toHaveBeenCalled();
    });

    it("refuses a number with no account and no signup, even on a signed call", async () => {
      Object.assign(known, { doctor: false, pending: false });
      const { POST } = await import("./route");
      const res = await POST(hookRequest(PAYLOAD));
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(send).not.toHaveBeenCalled();
    });

    it("fails closed when the database cannot answer", async () => {
      known.error = true;
      const { POST } = await import("./route");
      expect((await POST(hookRequest(PAYLOAD))).status).toBe(500);
      expect(send).not.toHaveBeenCalled();
    });

    it("warns once as the day crosses half the budget, and still sends", async () => {
      const { POST } = await import("./route");
      remaining = 101;
      await POST(hookRequest(PAYLOAD));
      expect(captureMessage).not.toHaveBeenCalled();
      remaining = 100;
      expect((await POST(hookRequest(PAYLOAD))).status).toBe(200);
      expect(captureMessage).toHaveBeenCalledWith("Half the daily SMS budget used", "warning");
      remaining = 99;
      await POST(hookRequest(PAYLOAD));
      expect(captureMessage).toHaveBeenCalledTimes(1);
    });

    it("stops at the site-wide daily cap", async () => {
      budgetLeft = false;
      const { POST } = await import("./route");
      expect((await POST(hookRequest(PAYLOAD))).status).toBe(400);
      expect(send).not.toHaveBeenCalled();
    });
  });

  it("answers 200 with a JSON content type on a delivered code", async () => {
    const { POST } = await import("./route");
    const res = await POST(hookRequest(PAYLOAD));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(send).toHaveBeenCalledWith("+972501234567", "123456");
  });

  it("sends nothing while the kill switch is on, even for a signed call", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_AUTH_DISABLED", "1");
    const { POST } = await import("./route");
    const res = await POST(hookRequest(PAYLOAD));
    vi.unstubAllEnvs();

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(send).not.toHaveBeenCalled();
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
