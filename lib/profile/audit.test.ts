// What a doctor changed about their own card reaches the activity log, and a
// rename of an accepted doctor reaches the admins (#16).

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { raiseAlert } = vi.hoisted(() => ({ raiseAlert: vi.fn(async () => {}) }));
vi.mock("@/lib/alerts", () => ({ raiseAlert }));

import { recordProfileEdit } from "./audit";

const rows: Record<string, unknown>[] = [];
const service = {
  from: () => ({
    insert: async (row: Record<string, unknown>) => (rows.push(row), { error: null }),
  }),
} as unknown as SupabaseClient;

const ME = { id: "d1", arabic_first_name: "سامر", arabic_family_name: "ناصر", is_admin_approved: true };

beforeEach(() => {
  rows.length = 0;
  raiseAlert.mockClear();
});

describe("recordProfileEdit", () => {
  it("logs the changed fields, never their text, except the name and workplace names", async () => {
    await recordProfileEdit(service, ME, { bio: "نبذة سرية", email: "a@b.test", arabic_first_name: "سمير" }, ["عيادة"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_doctor_id: "d1",
      action: "doctor_profile_edited",
      target_doctor_id: "d1",
      metadata: { fields: ["bio", "email", "arabic_first_name"], name_before: "سامر ناصر", name_after: "سمير ناصر", workplace_names: ["عيادة"] },
    });
    expect(JSON.stringify(rows)).not.toContain("نبذة سرية");
    expect(JSON.stringify(rows)).not.toContain("a@b.test");
  });

  it("alerts the admins when an accepted doctor is renamed, and only then", async () => {
    await recordProfileEdit(service, ME, { arabic_family_name: "خوري" }, null);
    expect(raiseAlert).toHaveBeenCalledWith(service, "doctor_renamed", { logOnly: { doctor_id: "d1", name_before: "سامر ناصر", name_after: "سامر خوري" } });
    raiseAlert.mockClear();
    await recordProfileEdit(service, { ...ME, is_admin_approved: false }, { arabic_family_name: "خوري" }, null);
    await recordProfileEdit(service, ME, { bio: "x" }, null);
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("records nothing, and does not fail, when nothing was sent or the log is down", async () => {
    await recordProfileEdit(service, ME, {}, null);
    expect(rows).toEqual([]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = { from: () => { throw new Error("down"); } } as unknown as SupabaseClient;
    await expect(recordProfileEdit(down, ME, { bio: "x" }, null)).resolves.toBeUndefined();
  });
});
