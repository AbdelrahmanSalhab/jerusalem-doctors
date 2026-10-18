// POST /api/login/resend must answer the same for registered and unknown
// numbers (no enumeration), and only send to an active, verified doctor.

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

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(jsonRequest("/api/login/resend", body));
}

describe("POST /api/login/resend", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    rateLimit.mockResolvedValue({ success: true });
    auth.signInWithOtp.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("resends to an active doctor without creating users", async () => {
    db.queue("doctors", { data: { id: "d1", is_active: true, is_phone_verified: true } });
    const res = await call({ phone: "0501234567" });
    expect(await res.json()).toEqual({ ok: true });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      phone: "+972501234567",
      options: { shouldCreateUser: false },
    });
  });

  it.each([
    null,
    { id: "d1", is_active: false, is_phone_verified: true },
    { id: "d1", is_active: true, is_phone_verified: false },
  ])("answers 200 without sending for %o", async (data) => {
    db.queue("doctors", { data });
    const res = await call({ phone: "0501234567" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("rejects a bad body, phone, or landline", async () => {
    expect((await call("x")).status).toBe(400);
    expect(await (await call({ phone: "12" })).json()).toMatchObject({ code: "invalid_phone" });
    expect(await (await call({ phone: "021234567" })).json()).toMatchObject({ code: "phone_unsupported" });
  });

  it("rate limits", async () => {
    rateLimit.mockResolvedValueOnce({ success: false });
    expect((await call({ phone: "0501234567" })).status).toBe(429);
  });

  it("throws on a real DB error", async () => {
    db.queue("doctors", { error: { code: "XX000" } });
    await expect(call({ phone: "0501234567" })).rejects.toMatchObject({ code: "XX000" });
  });

  it("reports a failed send as 502", async () => {
    db.queue("doctors", { data: { id: "d1", is_active: true, is_phone_verified: true } });
    auth.signInWithOtp.mockResolvedValue({ error: { message: "down" } });
    expect((await call({ phone: "0501234567" })).status).toBe(502);
  });

  it("short-circuits under the dev shim", async () => {
    vi.stubEnv("USE_DEV_USER", "1");
    expect(await (await call({ phone: "0501234567" })).json()).toEqual({ ok: true, dev_bypass: true });
  });
});
