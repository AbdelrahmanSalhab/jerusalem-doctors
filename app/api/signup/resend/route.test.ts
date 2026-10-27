// POST /api/signup/resend: only an unexpired pending signup gets a new code.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth, db, jsonRequest } from "@/test/fakeSupabase";

const rateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});
vi.mock("@/lib/supabase/server", async () => {
  const { auth } = await import("@/test/fakeSupabase");
  return { createSupabaseServerClient: async () => ({ auth }) };
});

const SESSION = "11111111-1111-4111-8111-111111111111";
const future = () => new Date(Date.now() + 60_000).toISOString();

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(jsonRequest("/api/signup/resend", body));
}

describe("POST /api/signup/resend", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    rateLimit.mockResolvedValue({ success: true });
    auth.signInWithOtp.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("resends to the pending phone", async () => {
    db.queue("pending_signups", { data: { id: SESSION, phone_e164: "+972501234567", expires_at: future() } });
    const res = await call({ signup_session_id: SESSION });
    expect(await res.json()).toEqual({ ok: true });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ phone: "+972501234567" });
    // The new code gets its own guesses.
    expect(db.argsOf("pending_signups", "update")).toEqual([[{ attempts: 0 }]]);
    expect(db.argsOf("usage_events", "insert")).toEqual([
      [{ kind: "otp_resent", doctor_id: null, meta: { flow: "signup", signup: SESSION } }],
    ]);
  });

  it("rejects a non-uuid session", async () => {
    expect((await call({ signup_session_id: "abc" })).status).toBe(400);
  });

  it("rate limits", async () => {
    rateLimit.mockResolvedValue({ success: false });
    expect((await call({ signup_session_id: SESSION })).status).toBe(429);
  });

  it.each([
    { data: null },
    { data: { id: SESSION, phone_e164: "+972501234567", expires_at: new Date(Date.now() - 1000).toISOString() } },
    { error: { code: "PGRST116" } },
  ])("answers 410 for a missing or expired session", async (result) => {
    db.queue("pending_signups", result);
    const res = await call({ signup_session_id: SESSION });
    expect(res.status).toBe(410);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("throws on a real DB error", async () => {
    db.queue("pending_signups", { error: { code: "XX000" } });
    await expect(call({ signup_session_id: SESSION })).rejects.toMatchObject({ code: "XX000" });
  });

  it("reports a failed send as 502", async () => {
    db.queue("pending_signups", { data: { id: SESSION, phone_e164: "+972501234567", expires_at: future() } });
    auth.signInWithOtp.mockResolvedValue({ error: { message: "down" } });
    expect((await call({ signup_session_id: SESSION })).status).toBe(502);
  });

  it("short-circuits under the dev shim", async () => {
    vi.stubEnv("USE_DEV_USER", "1");
    db.queue("pending_signups", { data: { id: SESSION, phone_e164: "+972501234567", expires_at: future() } });
    expect(await (await call({ signup_session_id: SESSION })).json()).toEqual({ ok: true, dev_bypass: true });
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
