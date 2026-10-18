// POST /api/login/start: the gates in front of the OTP send, in order.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth, db, jsonRequest } from "@/test/fakeSupabase";

const rateLimit = vi.hoisted(() => vi.fn());
const verifyTurnstile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});
vi.mock("@/lib/supabase/server", async () => {
  const { auth } = await import("@/test/fakeSupabase");
  return { createSupabaseServerClient: async () => ({ auth }) };
});

const ACTIVE = { id: "d1", is_active: true, is_phone_verified: true };

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(jsonRequest("/api/login/start", body));
}

describe("POST /api/login/start", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    rateLimit.mockResolvedValue({ success: true });
    verifyTurnstile.mockResolvedValue({ ok: true });
    auth.signInWithOtp.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends the OTP to an active doctor", async () => {
    db.queue("doctors", { data: ACTIVE });
    const res = await call({ phone: "050-123-4567", turnstile_token: "t" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, phone_e164: "+972501234567" });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      phone: "+972501234567",
      options: { channel: "sms" },
    });
  });

  it("rejects a malformed body", async () => {
    const res = await call("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_body" });
  });

  it("rejects a failed Turnstile check before touching the DB", async () => {
    verifyTurnstile.mockResolvedValue({ ok: false });
    const res = await call({ phone: "0501234567" });
    expect(res.status).toBe(403);
    expect(db.calls).toHaveLength(0);
  });

  it("rejects an invalid phone", async () => {
    const res = await call({ phone: "123" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_phone" });
  });

  it("rejects a landline before any send", async () => {
    const res = await call({ phone: "02-123-4567" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "phone_unsupported" });
  });

  it("rate limits by phone or IP", async () => {
    rateLimit.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
    const res = await call({ phone: "0501234567" });
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("loginStartIp", "ip:1.2.3.4");
  });

  // Enumeration: every number gets the response a registered one gets.
  const SENT = { ok: true, phone_e164: "+972501234567" };

  it("answers an unknown phone like a known one, without sending", async () => {
    const res = await call({ phone: "0501234567" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SENT);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it.each([
    { is_active: false, is_phone_verified: true },
    { is_active: true, is_phone_verified: false },
  ])("answers an inactive or unverified account the same way %o", async (flags) => {
    db.queue("doctors", { data: { id: "d1", ...flags } });
    const res = await call({ phone: "0501234567" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SENT);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("returns a JSON 500 on a DB error", async () => {
    db.queue("doctors", { error: { code: "XX000", message: "boom" } });
    const res = await call({ phone: "0501234567" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal_error" });
  });

  it("treats PGRST116 as no row", async () => {
    db.queue("doctors", { error: { code: "PGRST116" } });
    const res = await call({ phone: "0501234567" });
    expect(await res.json()).toEqual(SENT);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("answers a failed send like any other number, and reports it", async () => {
    db.queue("doctors", { data: ACTIVE });
    auth.signInWithOtp.mockResolvedValue({ error: { message: "hook failed" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call({ phone: "0501234567" });
    expect(res.status).toBe(200);
    expect(captureException).toHaveBeenCalled();
  });

  it("skips Supabase Auth under the dev shim", async () => {
    vi.stubEnv("USE_DEV_USER", "1");
    db.queue("doctors", { data: ACTIVE });
    const res = await call({ phone: "0501234567" });
    expect(await res.json()).toMatchObject({ dev_bypass: true });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("ignores the dev shim in production", async () => {
    vi.stubEnv("USE_DEV_USER", "1");
    vi.stubEnv("NODE_ENV", "production");
    db.queue("doctors", { data: ACTIVE });
    const res = await call({ phone: "0501234567" });
    expect(await res.json()).not.toHaveProperty("dev_bypass");
    expect(auth.signInWithOtp).toHaveBeenCalled();
  });
});

describe("emergency switch", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("refuses with 503 before sending anything", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_AUTH_DISABLED", "1");
    const res = await call({ phone: "050-123-4567", turnstile_token: "t", signup_session_id: "11111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "phone_auth_disabled" });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("usage events", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    rateLimit.mockResolvedValue({ success: true });
    verifyTurnstile.mockResolvedValue({ ok: true });
    auth.signInWithOtp.mockResolvedValue({ error: null });
  });

  const kinds = () => db.argsOf("usage_events", "insert").map(([row]) => (row as { kind: string }).kind);

  it("counts a login attempt from a number with no account, keeping no number", async () => {
    await call({ phone: "0501234567", turnstile_token: "t" });
    expect(kinds()).toEqual(["login_unregistered"]);
    expect(JSON.stringify(db.argsOf("usage_events", "insert"))).not.toContain("501234567");
  });

  it("counts a sent code, and a failed send", async () => {
    db.queue("doctors", { data: { id: "d1", is_active: true, is_phone_verified: true } });
    await call({ phone: "0501234567", turnstile_token: "t" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    auth.signInWithOtp.mockResolvedValue({ error: { message: "hook failed" } });
    db.queue("doctors", { data: { id: "d1", is_active: true, is_phone_verified: true } });
    await call({ phone: "0501234567", turnstile_token: "t" });
    expect(kinds()).toEqual(["login_code_sent", "login_send_failed"]);
  });
});
