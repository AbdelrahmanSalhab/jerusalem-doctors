// Admin specialty create (POST) and edit (PATCH [id]).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const requireAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

async function create(body: unknown) {
  const { POST } = await import("./route");
  return POST(jsonRequest("/api/admin/specialties", body));
}

async function patch(body: unknown) {
  const { PATCH } = await import("./[id]/route");
  return PATCH(jsonRequest("/api/admin/specialties/s1", body), { params: Promise.resolve({ id: "s1" }) });
}

describe("admin specialties", () => {
  beforeEach(() => {
    db.reset();
    requireAdmin.mockResolvedValue({ id: "admin" });
  });

  it.each([create, patch])("401s a non-admin (%#)", async (fn) => {
    requireAdmin.mockRejectedValue(new Error("NOT_FOUND"));
    expect((await fn({ name_ar: "جراحة" })).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it.each([create, patch])("400s a bad body (%#)", async (fn) => {
    expect((await fn({ name_ar: "x" })).status).toBe(400);
  });

  describe("POST", () => {
    it("appends after the last sort_order, normalized", async () => {
      db.queue("specialties", { data: { sort_order: 7 } }, {});
      expect((await create({ name_ar: "أمراض الجلد" })).status).toBe(200);
      expect(db.argsOf("specialties", "insert")[0][0]).toEqual({
        name_ar: "أمراض الجلد",
        name_ar_normalized: "امراض الجلد",
        name_he: null,
        name_en: null,
        sort_order: 8,
        is_active: true,
      });
    });

    it("starts at 1 on an empty table", async () => {
      await create({ name_ar: "جراحة", name_en: "Surgery" });
      expect(db.argsOf("specialties", "insert")[0][0]).toMatchObject({ sort_order: 1, name_en: "Surgery" });
    });

    it("500s when the insert fails", async () => {
      db.queue("specialties", {}, { error: { message: "x" } });
      expect((await create({ name_ar: "جراحة" })).status).toBe(500);
    });
  });

  describe("PATCH", () => {
    it("re-normalizes a renamed specialty", async () => {
      expect((await patch({ name_ar: "إسعاف", is_active: false })).status).toBe(200);
      expect(db.argsOf("specialties", "update")[0][0]).toEqual({
        name_ar: "إسعاف",
        name_ar_normalized: "اسعاف",
        is_active: false,
      });
      expect(db.argsOf("specialties", "eq")).toEqual([["id", "s1"]]);
    });

    it("rejects an empty update", async () => {
      expect(await (await patch({})).json()).toMatchObject({ code: "no_fields" });
    });

    it("500s when the update fails", async () => {
      db.queue("specialties", { error: { message: "x" } });
      expect((await patch({ sort_order: 2 })).status).toBe(500);
    });
  });
});
