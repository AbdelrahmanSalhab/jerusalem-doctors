// The switch's test button: the signed-in admin's own devices, and a clear
// answer when the keys are not set.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminOrNull = vi.hoisted(() => vi.fn());
const sendTestPush = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/push", () => ({ sendTestPush }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: gate.allowed })) }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ marker: "service" }) }));

const call = async () => (await import("./route")).POST(new Request("http://x/api/admin/push/test", { method: "POST" }));

beforeEach(() => {
  vi.clearAllMocks();
  gate.allowed = true;
  requireAdminOrNull.mockResolvedValue({ id: "admin-1" });
  sendTestPush.mockResolvedValue(2);
});

describe("POST /api/admin/push/test", () => {
  it("tests the admin's own devices and says how many it reached", async () => {
    const res = await call();
    expect(await res.json()).toEqual({ ok: true, sent: 2 });
    expect(sendTestPush).toHaveBeenCalledWith({ marker: "service" }, "admin-1");
  });

  it("is for admins only and rate limited", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(401);
    gate.allowed = false;
    expect((await call()).status).toBe(429);
    expect(sendTestPush).not.toHaveBeenCalled();
  });

  it("answers 503 when the keys are not set", async () => {
    sendTestPush.mockResolvedValueOnce(null);
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("push_not_configured");
  });
});
