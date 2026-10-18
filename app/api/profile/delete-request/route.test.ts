// POST /api/profile/delete-request hides and deactivates the caller at once.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const requireDoctor = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

async function call() {
  const { POST } = await import("./route");
  return POST(jsonRequest("/api/profile/delete-request", {}));
}

describe("POST /api/profile/delete-request", () => {
  beforeEach(() => {
    db.reset();
    requireDoctor.mockResolvedValue({ id: "d1" });
  });

  it("hides the doctor and audits the request", async () => {
    const res = await call();
    expect(await res.json()).toEqual({ ok: true });
    expect(db.argsOf("doctors", "update")).toEqual([[{ is_visible: false, is_active: false }]]);
    expect(db.argsOf("doctors", "eq")).toEqual([["id", "d1"]]);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toEqual({
      actor_doctor_id: "d1",
      action: "delete_requested",
      target_doctor_id: "d1",
      metadata: { ip: "1.2.3.4" },
    });
  });

  it("answers 401 without a session", async () => {
    requireDoctor.mockRejectedValue(new Error("NEXT_REDIRECT"));
    expect((await call()).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("answers 500 when the update fails, without auditing", async () => {
    db.queue("doctors", { error: { message: "x" } });
    const res = await call();
    expect(res.status).toBe(500);
    expect(db.argsOf("audit_logs", "insert")).toHaveLength(0);
  });
});
