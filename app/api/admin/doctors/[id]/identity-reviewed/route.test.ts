// The identity review of an accepted doctor (#16): who, how, and only once.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/test/fakeSupabase";

const admin = vi.hoisted(() => ({ current: { id: "a1" } as { id: string } | null }));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull: async () => admin.current }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

import { POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const OK = { approval_method: "institution_called", approval_reason: "اتصلت بمقسم المستشفى وأكّدوا" };
const call = (body: unknown = OK, id = ID) =>
  POST(new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  db.reset();
  admin.current = { id: "a1" };
});

describe("POST /api/admin/doctors/[id]/identity-reviewed", () => {
  it("401s a visitor and writes nothing", async () => {
    admin.current = null;
    expect((await call()).status).toBe(401);
    expect(db.argsOf("doctors", "update")).toEqual([]);
  });

  it("wants both the method and a reason of ten characters", async () => {
    expect((await call({ approval_reason: OK.approval_reason })).status).toBe(400);
    expect((await call({ approval_method: "documents_seen", approval_reason: "تمام" })).status).toBe(400);
    expect((await call({ approval_method: "i_think_so", approval_reason: OK.approval_reason })).status).toBe(400);
    expect(db.argsOf("doctors", "update")).toEqual([]);
  });

  it("404s a bad id and a doctor that does not exist, and 409s one who is not accepted", async () => {
    expect((await call(OK, "nope")).status).toBe(404);
    expect((await call()).status).toBe(404);
    db.queue("doctors", { data: { id: ID, is_admin: false, is_visible: true, is_admin_approved: false, identity_reviewed_at: null } });
    expect((await call()).status).toBe(409);
    expect(db.argsOf("doctors", "update")).toEqual([]);
    expect(db.argsOf("audit_logs", "insert")).toEqual([]);
  });

  it("marks the review, only while unreviewed, and logs the method and reason with the admin", async () => {
    db.queue("doctors", { data: { id: ID, is_admin: false, is_visible: true, is_admin_approved: true, identity_reviewed_at: null } }, { data: [{ id: ID }] });
    expect((await call()).status).toBe(200);
    expect(db.argsOf("doctors", "update")[0][0]).toEqual({ identity_reviewed_at: expect.any(String) });
    expect(db.argsOf("doctors", "is")).toEqual([["identity_reviewed_at", null]]);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toEqual({
      actor_doctor_id: "a1",
      action: "admin_identity_reviewed",
      target_doctor_id: ID,
      metadata: OK,
    });
  });

  it("refuses a hidden admin account (staff), but not an admin who is a visible doctor", async () => {
    db.queue("doctors", { data: { id: ID, is_admin: true, is_visible: false, is_admin_approved: true, identity_reviewed_at: null } });
    expect((await call()).status).toBe(409);
    expect(db.argsOf("doctors", "update")).toEqual([]);
    db.queue("doctors", { data: { id: ID, is_admin: true, is_visible: true, is_admin_approved: true, identity_reviewed_at: null } }, { data: [{ id: ID }] });
    expect((await call()).status).toBe(200);
  });

  it("writes no second log entry when another admin's review landed between the read and the write", async () => {
    db.queue("doctors", { data: { id: ID, is_admin: false, is_visible: true, is_admin_approved: true, identity_reviewed_at: null } }, { data: [] });
    expect(await (await call()).json()).toMatchObject({ unchanged: true });
    expect(db.argsOf("audit_logs", "insert")).toEqual([]);
  });

  it("does nothing for a doctor another admin already reviewed", async () => {
    db.queue("doctors", { data: { id: ID, is_admin: false, is_visible: true, is_admin_approved: true, identity_reviewed_at: "2026-11-04T10:00:00Z" } });
    const res = await call();
    expect(await res.json()).toMatchObject({ unchanged: true });
    expect(db.argsOf("doctors", "update")).toEqual([]);
    expect(db.argsOf("audit_logs", "insert")).toEqual([]);
  });
});
