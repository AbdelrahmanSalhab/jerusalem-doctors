// The record that an admin opened the "you are in" message for a doctor.

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
const call = (id = ID) => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  db.reset();
  admin.current = { id: "a1" };
});

describe("POST /api/admin/doctors/[id]/notified", () => {
  it("401s a visitor and writes nothing", async () => {
    admin.current = null;
    expect((await call()).status).toBe(401);
    expect(db.argsOf("audit_logs", "insert")).toEqual([]);
  });

  it("404s a bad id and a doctor that does not exist", async () => {
    expect((await call("nope")).status).toBe(404);
    expect((await call()).status).toBe(404);
    expect(db.argsOf("audit_logs", "insert")).toEqual([]);
  });

  it("logs that this admin told the doctor", async () => {
    db.queue("doctors", { data: { id: ID } });
    expect((await call()).status).toBe(200);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toMatchObject({ action: "approval_notified", actor_doctor_id: "a1", target_doctor_id: ID });
  });
});
