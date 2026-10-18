// POST /api/signup/check-unique: Turnstile-gated, and compares the canonical
// license serial so differently spelled duplicates are still caught.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const rateLimit = vi.hoisted(() => vi.fn());
const verifyTurnstile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const BODY = { phone: "0501234567", license_number: "12345", turnstile_token: "t" };

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(jsonRequest("/api/signup/check-unique", body));
}

describe("POST /api/signup/check-unique", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    rateLimit.mockResolvedValue({ success: true });
    verifyTurnstile.mockResolvedValue({ ok: true });
  });

  it("reports a free phone and license", async () => {
    db.queue("doctors", { count: 0 }, { count: 0 });
    expect(await (await call(BODY)).json()).toEqual({ available: true });
    expect(db.argsOf("doctors", "eq")).toEqual([
      ["phone_e164", "+972501234567"],
      ["license_region", "IL"],
      ["license_number", expect.any(String)],
    ]);
  });

  it("flags a taken phone", async () => {
    db.queue("doctors", { count: 1 });
    expect(await (await call(BODY)).json()).toEqual({ available: false, duplicate_field: "phone" });
  });

  it("flags a taken license", async () => {
    db.queue("doctors", { count: 0 }, { count: 1 });
    expect(await (await call(BODY)).json()).toEqual({ available: false, duplicate_field: "license_number" });
  });

  it("rate limits before parsing", async () => {
    rateLimit.mockResolvedValue({ success: false });
    expect((await call(BODY)).status).toBe(429);
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    expect((await call({ phone: "0501234567" })).status).toBe(400);
  });

  it("rejects a failed Turnstile check", async () => {
    verifyTurnstile.mockResolvedValue({ ok: false });
    expect((await call(BODY)).status).toBe(403);
    expect(db.calls).toHaveLength(0);
  });

  it("rejects an invalid phone", async () => {
    expect(await (await call({ ...BODY, phone: "12" })).json()).toMatchObject({ code: "invalid_phone" });
  });

  it("rejects a malformed license", async () => {
    const res = await call({ ...BODY, license_number: "abc" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_license" });
  });

  it.each([[{ error: { code: "XX000" } }], [{ count: 0 }, { error: { code: "XX000" } }]])(
    "returns a JSON 500 on a DB error",
    async (...results) => {
      db.queue("doctors", ...results);
      expect((await call(BODY)).status).toBe(500);
    },
  );
});
