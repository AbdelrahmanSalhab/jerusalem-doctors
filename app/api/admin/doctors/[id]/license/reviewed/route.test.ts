// «تمت المراجعة»: an admin accepts a licence as it stands. Admins only, and
// every one is logged with who, which status it had and the note.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const requireAdminOrNull = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: gate.allowed })) }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const ID = "00000000-0000-4000-8000-0000000000d1";
const call = async (body: unknown = {}, id = ID) =>
  (await import("./route")).POST(jsonRequest(`/api/admin/doctors/${id}/license/reviewed`, body), { params: Promise.resolve({ id }) });

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  gate.allowed = true;
  requireAdminOrNull.mockResolvedValue({ id: "admin-1" });
  db.queue("doctors", { data: { license_verification_status: "not_found" } });
});

describe("POST /api/admin/doctors/[id]/license/reviewed", () => {
  it("marks the licence reviewed and logs it with the status it had and the note", async () => {
    expect((await call({ note: "  تحققت من الشهادة  " })).status).toBe(200);
    expect(db.argsOf("doctors", "update")).toEqual([[{ license_reviewed_at: expect.any(String) }]]);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toMatchObject({
      actor_doctor_id: "admin-1",
      action: "admin_license_reviewed",
      target_doctor_id: ID,
      metadata: { license_status: "not_found", note: "تحققت من الشهادة" },
    });
  });

  it("needs no note, and no body at all", async () => {
    expect((await call({})).status).toBe(200);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toMatchObject({ metadata: { license_status: "not_found" } });
    expect(db.argsOf("audit_logs", "insert")[0][0]).not.toHaveProperty("metadata.note");
    db.queue("doctors", { data: { license_verification_status: null } });
    const { POST } = await import("./route");
    expect((await POST(new Request("http://x/y", { method: "POST" }), { params: Promise.resolve({ id: ID }) })).status).toBe(200);
  });

  it("is for admins only, and brakes a loop", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(401);
    gate.allowed = false;
    expect((await call()).status).toBe(429);
    expect(db.argsOf("doctors", "update")).toEqual([]);
  });

  it("answers 404 for a malformed id or a doctor who is not there, and 400 for a note that is too long", async () => {
    expect((await call({}, "abc")).status).toBe(404);
    db.reset();
    db.queue("doctors", { data: null });
    expect((await call()).status).toBe(404);
    db.queue("doctors", { data: { license_verification_status: null } });
    expect((await call({ note: "ا".repeat(301) })).status).toBe(400);
  });

  it("fails without logging when the doctor cannot be read or updated", async () => {
    db.reset();
    db.queue("doctors", { error: { code: "XX000", message: "boom" } });
    expect((await call()).status).toBe(500);
    db.queue("doctors", { data: { license_verification_status: "not_found" } }, { error: { message: "boom" } });
    expect((await call()).status).toBe(500);
    expect(db.argsOf("audit_logs", "insert")).toEqual([]);
  });
});
