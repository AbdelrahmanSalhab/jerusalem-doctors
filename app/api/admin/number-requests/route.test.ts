// Admins close a number request once they've sent the number.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const requireAdminOrNull = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const ID = "00000000-0000-4000-8000-0000000001a1";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

async function call(id = ID) {
  const { PATCH } = await import("./[id]/route");
  return PATCH(jsonRequest(`/api/admin/number-requests/${id}`, {}), ctx(id));
}

describe("PATCH /api/admin/number-requests/[id]", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    requireAdminOrNull.mockResolvedValue({ id: "admin-1" });
  });

  it("refuses a non-admin", async () => {
    requireAdminOrNull.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("closes an open request and audits it", async () => {
    db.queue("number_requests", { data: { requester_id: "d1", query: "أحمد" } });
    const res = await call();
    expect(await res.json()).toEqual({ ok: true });
    expect(db.argsOf("number_requests", "update")[0][0]).toHaveProperty("resolved_at");
    expect(db.argsOf("number_requests", "is")).toEqual([["resolved_at", null]]);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toEqual({
      actor_doctor_id: "admin-1",
      action: "number_request_resolved",
      target_doctor_id: "d1",
      metadata: { query: "أحمد" },
    });
  });

  it("404s a request that is unknown or already closed", async () => {
    expect((await call()).status).toBe(404);
    expect(db.argsOf("audit_logs", "insert")).toHaveLength(0);
  });

  it("404s a malformed id without touching the database", async () => {
    expect((await call("nope")).status).toBe(404);
    expect(db.calls).toHaveLength(0);
  });
});
