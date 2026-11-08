// PATCH /api/admin/settings: who may flip the directory's switches, what is
// written and what the other admins are told.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/test/fakeSupabase";

const { requireAdminOrNull, writeAudit, raiseAlert, siteSettingsChanged, fetchSiteSettings } = vi.hoisted(() => ({
  requireAdminOrNull: vi.fn(),
  writeAudit: vi.fn(async () => {}),
  raiseAlert: vi.fn(async () => {}),
  siteSettingsChanged: vi.fn(),
  fetchSiteSettings: vi.fn(),
}));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/audit", () => ({ writeAudit }));
vi.mock("@/lib/alerts", () => ({ raiseAlert }));
vi.mock("@/lib/cachedReads", () => ({ siteSettingsChanged }));
vi.mock("@/lib/siteSettings", async (orig) => ({ ...(await orig<typeof import("@/lib/siteSettings")>()), fetchSiteSettings }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const call = async (body: unknown) => {
  const { PATCH } = await import("./route");
  return PATCH(
    new Request("https://example.test/api/admin/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
};

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  requireAdminOrNull.mockResolvedValue({ id: "admin-1" });
  fetchSiteSettings.mockResolvedValue({ search_before_review: false, contacts_without_tap: false });
});

describe("PATCH /api/admin/settings", () => {
  it("is for admins", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await call({ search_before_review: true })).status).toBe(401);
    expect(db.argsOf("site_settings", "update")).toEqual([]);
  });

  it("refuses an empty body, an unknown switch and a non-boolean", async () => {
    for (const body of [{}, { other: true }, { search_before_review: "yes" }, "not json", null]) {
      expect((await call(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(db.argsOf("site_settings", "update")).toEqual([]);
  });

  it("opens a switch: saves it, clears the cache, logs who did it and tells the other admins", async () => {
    const res = await call({ contacts_without_tap: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ search_before_review: false, contacts_without_tap: true });
    expect(db.argsOf("site_settings", "update")).toEqual([[{ contacts_without_tap: true, updated_at: expect.any(String) }]]);
    expect(db.argsOf("site_settings", "eq")).toEqual([["id", true]]);
    expect(siteSettingsChanged).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(db.client, {
      actor_doctor_id: "admin-1",
      action: "directory_setting_changed",
      metadata: { setting: "contacts_without_tap", enabled: true },
    });
    expect(raiseAlert).toHaveBeenCalledWith(db.client, "directory_setting_on", { extra: { setting: "contacts_without_tap", doctor_id: "admin-1" } });
  });

  it("closes a switch the same way, without an alert", async () => {
    fetchSiteSettings.mockResolvedValue({ search_before_review: true, contacts_without_tap: false });
    const res = await call({ search_before_review: false });
    expect(await res.json()).toEqual({ search_before_review: false, contacts_without_tap: false });
    expect(writeAudit).toHaveBeenCalledWith(db.client, expect.objectContaining({ metadata: { setting: "search_before_review", enabled: false } }));
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("writes and logs only what changed", async () => {
    fetchSiteSettings.mockResolvedValue({ search_before_review: true, contacts_without_tap: false });
    await call({ search_before_review: true, contacts_without_tap: true });
    expect(db.argsOf("site_settings", "update")).toEqual([[{ contacts_without_tap: true, updated_at: expect.any(String) }]]);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and says so, when nothing changes", async () => {
    const res = await call({ search_before_review: false });
    expect(await res.json()).toMatchObject({ unchanged: true });
    expect(db.argsOf("site_settings", "update")).toEqual([]);
    expect(siteSettingsChanged).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("reports a failed save instead of answering as if it worked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.queue("site_settings", { error: { message: "boom" } });
    expect((await call({ search_before_review: true })).status).toBe(500);
    expect(siteSettingsChanged).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
