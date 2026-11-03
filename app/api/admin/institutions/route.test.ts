// Admin institution edits: admin only, and every change re-links workplaces
// and lands in the audit log.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const { requireAdminOrNull, relinkWorkplaces, institutionsChanged } = vi.hoisted(() => ({
  requireAdminOrNull: vi.fn(),
  institutionsChanged: vi.fn(),
  relinkWorkplaces: vi.fn(async () => ({ changed: 3, unmatched: [] as { name: string; count: number }[] })),
}));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/cachedReads", () => ({ institutionsChanged }));
vi.mock("@/lib/institutions", async (orig) => ({
  ...(await orig<typeof import("@/lib/institutions")>()),
  relinkWorkplaces,
}));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const ctx = { params: Promise.resolve({ id: "00000000-0000-4000-8000-0000000001a1" }) };

describe("admin institutions API", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    requireAdminOrNull.mockResolvedValue({ id: "admin-1" });
  });

  it("refuses a non-admin", async () => {
    requireAdminOrNull.mockResolvedValue(null);
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
    // Search reads the list from a cache; it must see the new one.
    expect(institutionsChanged).toHaveBeenCalled();
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

  it("404s a malformed id without asking the database", async () => {
    const { DELETE } = await import("./[id]/route");
    const res = await DELETE(jsonRequest("/x", {}), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(404);
    expect(relinkWorkplaces).not.toHaveBeenCalled();
  });

  it("refuses a bad body on create, and rethrows any other database error", async () => {
    const { POST } = await import("./route");
    const bad = await POST(jsonRequest("/api/admin/institutions", { name_ar: "x" }));
    expect(bad.status).toBe(400);
    const notJson = await POST(new Request("http://x/api/admin/institutions", { method: "POST", body: "nope" }));
    expect(notJson.status).toBe(400);
    db.queue("institutions", { error: { code: "XX000", message: "boom" } });
    expect((await POST(jsonRequest("/api/admin/institutions", { name_ar: "مستشفى جديد", kind: "hospital" }))).status).toBe(500);
  });

  it("edits fields, clearing the Hebrew name when sent empty", async () => {
    db.queue("institutions", { data: { aliases: [] } }, {});
    const { PATCH } = await import("./[id]/route");
    const res = await PATCH(jsonRequest("/api/admin/institutions/inst-1", { name_ar: "اسم جديد", name_he: "", kind: "hmo" }), ctx);
    expect(res.status).toBe(200);
    expect(db.argsOf("institutions", "update")[0][0]).toEqual({ name_ar: "اسم جديد", name_he: null, kind: "hmo" });
  });

  it("keeps the Hebrew name when it is not in the body", async () => {
    db.queue("institutions", { data: { aliases: [] } }, {});
    const { PATCH } = await import("./[id]/route");
    await PATCH(jsonRequest("/api/admin/institutions/inst-1", { kind: "hospital" }), ctx);
    expect(db.argsOf("institutions", "update")[0][0]).toEqual({ kind: "hospital" });
  });

  it("refuses a non-admin, a bad body, a missing institution and a duplicate name on edit", async () => {
    const { PATCH, DELETE } = await import("./[id]/route");
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await PATCH(jsonRequest("/x", { kind: "hmo" }), ctx)).status).toBe(401);
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await DELETE(jsonRequest("/x", {}), ctx)).status).toBe(401);
    expect((await PATCH(jsonRequest("/x", { kind: "moon" }), ctx)).status).toBe(400);
    expect((await PATCH(new Request("http://x", { method: "PATCH", body: "nope" }), ctx)).status).toBe(400);
    expect((await PATCH(jsonRequest("/x", { kind: "hmo" }), { params: Promise.resolve({ id: "abc" }) })).status).toBe(404);
    db.queue("institutions", { data: null });
    expect((await PATCH(jsonRequest("/x", { kind: "hmo" }), ctx)).status).toBe(404);
    db.queue("institutions", { data: { aliases: [] } }, { error: { code: "23505" } });
    expect((await PATCH(jsonRequest("/x", { name_ar: "مكرر" }), ctx)).status).toBe(409);
  });

  it("rethrows other errors on read, edit and delete", async () => {
    const { PATCH, DELETE } = await import("./[id]/route");
    db.queue("institutions", { error: { message: "read" } });
    expect((await PATCH(jsonRequest("/x", { kind: "hmo" }), ctx)).status).toBe(500);
    db.queue("institutions", { data: { aliases: [] } }, { error: { code: "XX000", message: "write" } });
    expect((await PATCH(jsonRequest("/x", { kind: "hmo" }), ctx)).status).toBe(500);
    db.queue("institutions", { error: { message: "delete" } });
    expect((await DELETE(jsonRequest("/x", {}), ctx)).status).toBe(500);
  });
});
