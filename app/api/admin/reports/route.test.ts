// Admins close a profile report with a note.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const requireAdminOrNull = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const ID = "00000000-0000-4000-8000-0000000003c3";
const call = async (body: unknown) =>
  (await import("./[id]/route")).PATCH(jsonRequest(`/api/admin/reports/${ID}`, body), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  requireAdminOrNull.mockResolvedValue({ id: "admin-1" });
});

describe("PATCH /api/admin/reports/[id]", () => {
  it("closes an open report with the admin's note and logs it", async () => {
    db.queue("profile_reports", { data: { target_doctor_id: "d1" } });
    expect((await call({ note: "تواصلت مع الطبيب، الملف صحيح" })).status).toBe(200);
    expect(db.argsOf("profile_reports", "update")[0][0]).toMatchObject({ resolved_by: "admin-1", resolution_note: "تواصلت مع الطبيب، الملف صحيح" });
    expect(db.argsOf("profile_reports", "is")).toEqual([["resolved_at", null]]);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toMatchObject({ action: "profile_report_resolved", target_doctor_id: "d1" });
  });

  it("refuses a non-admin, a missing note, and a report already closed", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await call({ note: "تم" })).status).toBe(401);
    expect((await call({ note: "" })).status).toBe(400);
    db.queue("profile_reports", { data: null });
    expect((await call({ note: "تم" })).status).toBe(404);
  });
});
