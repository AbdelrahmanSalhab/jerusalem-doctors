// Admin institution edits: admin only, and every change re-links workplaces
// and lands in the audit log.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const { requireAdmin, relinkWorkplaces } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  relinkWorkplaces: vi.fn(async () => ({ changed: 3, unmatched: [] as { name: string; count: number }[] })),
}));
vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/institutions", async (orig) => ({
  ...(await orig<typeof import("@/lib/institutions")>()),
  relinkWorkplaces,
}));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const ctx = { params: Promise.resolve({ id: "inst-1" }) };

describe("admin institutions API", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: "admin-1" });
  });

  it("refuses a non-admin", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    const { POST } = await import("./route");
    const res = await POST(jsonRequest("/api/admin/institutions", { name_ar: "x", kind: "hospital" }));
    expect(res.status).toBe(401);
    expect(relinkWorkplaces).not.toHaveBeenCalled();
  });

  it("creates an institution, re-links, and audits", async () => {
    db.queue("institutions", { data: { id: "inst-9" } });
    const { POST } = await import("./route");
    const res = await POST(
      jsonRequest("/api/admin/institutions", { name_ar: "مستشفى الهلال الأحمر", kind: "hospital", aliases: ["الهلال"] }),
    );
    expect(await res.json()).toEqual({ ok: true, id: "inst-9", linked: 3 });
    expect(db.argsOf("institutions", "insert")[0][0]).toMatchObject({ name_ar: "مستشفى الهلال الأحمر", name_he: null });
    expect(relinkWorkplaces).toHaveBeenCalled();
    expect(db.argsOf("audit_logs", "insert")[0][0]).toMatchObject({ action: "institution_created" });
  });

  it("reports a duplicate name as 409", async () => {
    db.queue("institutions", { error: { code: "23505" } });
    const { POST } = await import("./route");
    const res = await POST(jsonRequest("/api/admin/institutions", { name_ar: "المقاصد", kind: "hospital" }));
    expect(res.status).toBe(409);
  });

  it("claims an unmatched name as a new spelling, without duplicating it", async () => {
    db.queue("institutions", { data: { aliases: ["شعري تسيدك"] } }, {});
    const { PATCH } = await import("./[id]/route");
    const res = await PATCH(jsonRequest("/api/admin/institutions/inst-1", { add_alias: "شعري تسيدك" }), ctx);
    expect(res.status).toBe(200);
    expect(db.argsOf("institutions", "update")[0][0]).toEqual({ aliases: ["شعري تسيدك"] });
    expect(relinkWorkplaces).toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ still_unlinked: false });
  });

  it("says when a claimed name still didn't link", async () => {
    relinkWorkplaces.mockResolvedValueOnce({ changed: 0, unmatched: [{ name: "مقاصد", count: 1 }] });
    db.queue("institutions", { data: { aliases: [] } }, {});
    const { PATCH } = await import("./[id]/route");
    const res = await PATCH(jsonRequest("/api/admin/institutions/inst-1", { add_alias: "مقاصد" }), ctx);
    expect(await res.json()).toMatchObject({ still_unlinked: true });
  });

  it("deletes, re-links, and 404s an unknown id", async () => {
    db.queue("institutions", { data: { name_ar: "x" } });
    const { DELETE } = await import("./[id]/route");
    expect((await DELETE(jsonRequest("/x", {}), ctx)).status).toBe(200);
    expect(relinkWorkplaces).toHaveBeenCalled();
    db.queue("institutions", { data: null });
    expect((await DELETE(jsonRequest("/x", {}), ctx)).status).toBe(404);
  });
});
