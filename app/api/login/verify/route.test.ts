// POST /api/login/verify: OTP check, then the auth_user_id link that lets
// getCurrentDoctor find the doctor on later requests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAfter } from "@/test/after";
import { auth, db, jsonRequest } from "@/test/fakeSupabase";

const rateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("@/test/after")).deferAfter,
}));

vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});
vi.mock("@/lib/supabase/server", async () => {
  const { auth } = await import("@/test/fakeSupabase");
  return { createSupabaseServerClient: async () => ({ auth }) };
});

const GOOD = { phone: "0501234567", otp_code: "123456" };

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(jsonRequest("/api/login/verify", body));
}

describe("POST /api/login/verify", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    rateLimit.mockResolvedValue({ success: true });
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("logs in an already linked doctor without writing", async () => {
    db.queue("doctors", { data: { id: "d1", is_active: true, is_admin_approved: true, auth_user_id: "u1" } });
    const res = await call(GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, is_admin_approved: true });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ phone: "+972501234567", token: "123456", type: "sms" });
    expect(db.argsOf("doctors", "update")).toHaveLength(0);
  });

  it("links auth_user_id when it differs", async () => {
    db.queue("doctors", { data: { id: "d1", is_active: true, is_admin_approved: false, auth_user_id: null } }, {});
    const res = await call(GOOD);
    expect(await res.json()).toEqual({ ok: true, is_admin_approved: false });
    expect(db.argsOf("doctors", "update")).toEqual([[{ auth_user_id: "u1" }]]);
  });

  it("fails when the link write fails", async () => {
    db.queue("doctors", { data: { id: "d1", auth_user_id: null } }, { error: { message: "x" } });
    const res = await call(GOOD);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "link_failed" });
  });

  it.each([{ phone: "0501234567", otp_code: "12" }, { phone: "", otp_code: "123456" }, "nope"])(
    "rejects an invalid body %o",
    async (body) => {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalid_body" });
    },
  );

  it("rejects an invalid phone", async () => {
    const res = await call({ ...GOOD, phone: "12" });
    expect(await res.json()).toMatchObject({ code: "invalid_phone" });
  });

  it("rate limits", async () => {
    rateLimit.mockResolvedValue({ success: false });
    const res = await call(GOOD);
    expect(res.status).toBe(429);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    // Counted against the doctor the number belongs to.
    db.queue("doctors", { data: { id: "doc-1" } });
    await runAfter();
    expect(db.argsOf("usage_events", "insert")).toEqual([
      [{ kind: "otp_locked", doctor_id: "doc-1", meta: { flow: "login" } }],
    ]);
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: null }, error: { message: "expired" } },
  ])("rejects a wrong or expired code", async (result) => {
    auth.verifyOtp.mockResolvedValue(result);
    const res = await call(GOOD);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_otp" });
    // A number with no doctor still counts, against nobody.
    db.queue("doctors", { data: null });
    await runAfter();
    expect(db.argsOf("usage_events", "insert")).toEqual([
      [{ kind: "otp_refused", doctor_id: null, meta: { flow: "login" } }],
    ]);
  });

  it("answers 404 when no doctor has the phone", async () => {
    const res = await call(GOOD);
    expect(res.status).toBe(404);
  });

  describe("dev shim", () => {
    beforeEach(() => vi.stubEnv("USE_DEV_USER", "1"));

    it("accepts any code for a known phone", async () => {
      db.queue("doctors", { data: { id: "d1", is_active: true, is_admin_approved: true } });
      const res = await call(GOOD);
      expect(await res.json()).toEqual({ ok: true, is_admin_approved: true, dev_bypass: true });
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });

    it("answers 404 for an unknown phone", async () => {
      const res = await call(GOOD);
      expect(res.status).toBe(404);
    });

    it("is ignored in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: null });
      const res = await call(GOOD);
      expect(res.status).toBe(400);
      expect(auth.verifyOtp).toHaveBeenCalled();
    });
  });
});
