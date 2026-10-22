// POST /api/number-requests queues a "send me this doctor's number" request.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const { requireDoctor, rateLimit } = vi.hoisted(() => ({
  requireDoctor: vi.fn(),
  rateLimit: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
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
    requireDoctor.mockResolvedValue({ id: "d1" });
    rateLimit.mockResolvedValue({ success: true });
  });

  it("saves the trimmed search text for the caller", async () => {
    const res = await call({ q: "  أحمد خليل " });
    expect(await res.json()).toEqual({ ok: true });
    expect(db.argsOf("number_requests", "insert")).toEqual([[{ requester_id: "d1", query: "أحمد خليل" }]]);
    expect(rateLimit).toHaveBeenCalledWith("numberRequest", "doctor:d1");
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
});
