// POST /api/number-requests queues a "send me this doctor's number" request.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const { requireDoctor, rateLimit, raiseAlert } = vi.hoisted(() => ({
  requireDoctor: vi.fn(),
  rateLimit: vi.fn(async () => ({ success: true })),
  raiseAlert: vi.fn(async () => {}),
}));

vi.mock("@/lib/alerts", () => ({ raiseAlert }));
vi.mock("@/lib/auth/session", () => ({ requireDoctor, awaitingSecondFactor: async () => false }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(jsonRequest("/api/number-requests", body));
}

describe("POST /api/number-requests", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    requireDoctor.mockResolvedValue({ id: "d1", is_active: true, is_admin_approved: true, is_admin: false });
    rateLimit.mockResolvedValue({ success: true });
  });

  it("saves the trimmed search text for the caller", async () => {
    const res = await call({ q: "  أحمد خليل " });
    expect(await res.json()).toEqual({ ok: true });
    expect(db.argsOf("number_requests", "insert")).toEqual([[{ requester_id: "d1", query: "أحمد خليل" }]]);
    expect(rateLimit).toHaveBeenCalledWith("numberRequest", "doctor:d1");
  });

  it("tells the admins someone is waiting, with no name or search text", async () => {
    await call({ q: "أحمد خليل" });
    expect(raiseAlert).toHaveBeenCalledTimes(1);
    expect(raiseAlert).toHaveBeenCalledWith(db.client, "number_requested");
  });

  it("403s a doctor an admin has not accepted yet: no request, no alert (#16)", async () => {
    requireDoctor.mockResolvedValueOnce({ id: "d1", is_active: true, is_admin_approved: false, is_admin: false });
    expect((await call({ q: "أحمد خليل" })).status).toBe(403);
    expect(db.argsOf("number_requests", "insert")).toEqual([]);
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    requireDoctor.mockRejectedValue(new Error("NEXT_REDIRECT"));
    expect((await call({ q: "x" })).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("refuses empty text", async () => {
    expect((await call({ q: "   " })).status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it("answers 429 over the daily limit, without saving", async () => {
    rateLimit.mockResolvedValueOnce({ success: false });
    expect((await call({ q: "x" })).status).toBe(429);
    expect(db.calls).toHaveLength(0);
  });

  it("answers 500 when the insert fails", async () => {
    db.queue("number_requests", { error: { message: "x" } });
    expect((await call({ q: "x" })).status).toBe(500);
  });

  it("tells nobody when nothing was saved", async () => {
    requireDoctor.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await call({ q: "x" });
    await call({ q: "   " });
    rateLimit.mockResolvedValueOnce({ success: false });
    await call({ q: "x" });
    db.queue("number_requests", { error: { message: "x" } });
    await call({ q: "x" });
    expect(raiseAlert).not.toHaveBeenCalled();
  });
});
