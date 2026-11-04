// DELETE /api/admin/doctors/[id] erases a suspended doctor: photo, login and
// row, in an order where any failure leaves the row for a retry.

import { beforeEach, describe, expect, it, vi } from "vitest";

const steps: string[] = [];
let doctor: { id: string; is_active: boolean; auth_user_id: string | null } | null;
let photoError: unknown;
let userError: { status?: number } | null;
let rowError: unknown;
let trailError: unknown;
let readError: unknown;
let audits: Record<string, unknown>[];
let accepted: { id: string; metadata: Record<string, unknown> }[] = [];
let acceptedError: unknown = null;
let scrubs: { id: string; values: Record<string, unknown> }[] = [];

const { requireAdminOrNull } = vi.hoisted(() => ({
  requireAdminOrNull: vi.fn(async (): Promise<{ id: string } | null> => ({ id: "00000000-0000-4000-8000-00000000a001" })),
}));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => {
        const chain: Record<string, unknown> = {
          maybeSingle: async () => ({ data: doctor, error: readError }),
          // The acceptances kept in the log: .eq().eq().filter()
          then: (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data: table === "audit_logs" ? accepted : [], error: acceptedError }).then(ok),
        };
        chain.eq = () => chain;
        chain.filter = () => chain;
        return chain;
      },
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          steps.push(`scrub:${id}`);
          scrubs.push({ id, values });
          return { error: null };
        },
      }),
      delete: () => ({
        eq: async () => {
          steps.push(`delete:${table}`);
          return { error: table === "doctors" ? rowError : table === "audit_logs" ? trailError : null };
        },
      }),
      insert: async (row: Record<string, unknown>) => {
        audits.push(row);
        return { error: null };
      },
    }),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          steps.push(`photos:${paths.join(",")}`);
          return { error: photoError };
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          steps.push(`user:${id}`);
          return { error: userError };
        },
      },
    },
  }),
}));

async function del(id = "00000000-0000-4000-8000-0000000000d1") {
  const { DELETE } = await import("./route");
  const res = await DELETE(new Request(`https://example.test/api/admin/doctors/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, body: await res.json() };
}

describe("DELETE /api/admin/doctors/[id]", () => {
  beforeEach(() => {
    steps.length = 0;
    doctor = { id: "00000000-0000-4000-8000-0000000000d1", is_active: false, auth_user_id: "u1" };
    photoError = null;
    userError = null;
    rowError = null;
    trailError = null;
    readError = null;
    audits = [];
    accepted = [];
    acceptedError = null;
    scrubs = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("erases photo, login, audit trail and row, then audits without personal data", async () => {
    expect((await del()).status).toBe(200);
    expect(steps).toEqual(["photos:00000000-0000-4000-8000-0000000000d1.jpg,00000000-0000-4000-8000-0000000000d1.png,00000000-0000-4000-8000-0000000000d1.webp", "user:u1", "delete:audit_logs", "delete:doctors"]);
    expect(audits).toEqual([
      {
        actor_doctor_id: "00000000-0000-4000-8000-00000000a001",
        action: "admin_doctor_deleted",
        target_doctor_id: null,
        metadata: { deleted_doctor_id: "00000000-0000-4000-8000-0000000000d1" },
      },
    ]);
  });

  it("keeps who accepted the doctor, when and how, scrubbed of the person and the free-text reason", async () => {
    accepted = [
      { id: "a1", metadata: { is_admin_approved: true, approval_reason: "اتصلت بالدكتور فلان الذي يعرفه", approval_method: "institution_called", license_status_at_approval: "verified" } },
    ];
    expect((await del()).status).toBe(200);
    // The acceptance is rewritten before the rest of the trail goes.
    expect(steps.indexOf("scrub:a1")).toBeGreaterThan(steps.indexOf("user:u1"));
    expect(steps.indexOf("scrub:a1")).toBeLessThan(steps.indexOf("delete:audit_logs"));
    expect(scrubs).toEqual([
      {
        id: "a1",
        values: {
          target_doctor_id: null,
          metadata: {
            deleted_doctor_id: "00000000-0000-4000-8000-0000000000d1",
            is_admin_approved: true,
            approval_method: "institution_called",
            license_status_at_approval: "verified",
          },
        },
      },
    ]);
    expect(JSON.stringify(scrubs)).not.toContain("فلان");
  });

  it("keeps the row when the acceptances cannot be rewritten", async () => {
    acceptedError = { message: "boom" };
    expect((await del()).status).toBe(500);
    expect(steps).not.toContain("delete:doctors");
  });

  it("refuses a non-admin", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await del()).status).toBe(401);
    expect(steps).toEqual([]);
  });

  it("refuses to delete the admin's own account", async () => {
    expect((await del("00000000-0000-4000-8000-00000000a001")).body.code).toBe("cannot_delete_self");
    expect(steps).toEqual([]);
  });

  it("refuses an active account and a missing one", async () => {
    doctor = { id: "00000000-0000-4000-8000-0000000000d1", is_active: true, auth_user_id: "u1" };
    expect((await del()).body.code).toBe("still_active");
    doctor = null;
    expect((await del()).status).toBe(404);
    expect(steps).toEqual([]);
  });

  it("keeps the row when the photo can't be removed", async () => {
    photoError = { message: "boom" };
    expect((await del()).status).toBe(500);
    expect(steps).toEqual(["photos:00000000-0000-4000-8000-0000000000d1.jpg,00000000-0000-4000-8000-0000000000d1.png,00000000-0000-4000-8000-0000000000d1.webp"]);
  });

  it("keeps the row when the login can't be removed, but tolerates one already gone", async () => {
    userError = { status: 500 };
    expect((await del()).status).toBe(500);
    expect(steps.at(-1)).toBe("user:u1");

    steps.length = 0;
    userError = { status: 404 };
    expect((await del()).status).toBe(200);
    expect(steps.at(-1)).toBe("delete:doctors");
  });

  it("skips the login step for a row without one, and reports a failed row delete", async () => {
    doctor = { id: "00000000-0000-4000-8000-0000000000d1", is_active: false, auth_user_id: null };
    rowError = { message: "boom" };
    expect((await del()).status).toBe(500);
    expect(steps).toEqual(["photos:00000000-0000-4000-8000-0000000000d1.jpg,00000000-0000-4000-8000-0000000000d1.png,00000000-0000-4000-8000-0000000000d1.webp", "delete:audit_logs", "delete:doctors"]);
    expect(audits).toEqual([]);
  });

  it("answers 404 to an id that is not an id, and 500 when the doctor cannot be read", async () => {
    expect((await del("abc")).status).toBe(404);
    readError = { code: "XX000", message: "boom" };
    expect((await del()).status).toBe(500);
  });

  it("stops before erasing the row when the audit trail cannot be scrubbed", async () => {
    trailError = { message: "boom" };
    const out = await del();
    expect(out.status).toBe(500);
    expect(steps).not.toContain("delete:doctors");
  });
});
