// The nightly registry refresh: its door is the secret, and it refuses to act
// on an answer that would flag or delete good data.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/test/fakeSupabase";

const client = vi.hoisted(() => ({ findAll: vi.fn(), findByLicenses: vi.fn(), requests: 3 }));
const saveRegistryRows = vi.hoisted(() => vi.fn(async () => {}));
const writeAudit = vi.hoisted(() => vi.fn(async () => {}));
const raiseAlert = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/moh/client", () => ({ MohClient: class { findAll = client.findAll; findByLicenses = client.findByLicenses; get requests() { return client.requests; } } }));
vi.mock("@/lib/moh/registry", () => ({
  toRegistryRows: (records: { license_number: number }[]) => records,
  saveRegistryRows,
}));
vi.mock("@/lib/audit", () => ({ writeAudit }));
vi.mock("@/lib/alerts", () => ({ raiseAlert }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const call = async (secret: string | null = "s3cret") =>
  (await import("./route")).GET(new Request("http://x/api/cron/sync-moh", { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

const doctor = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  arabic_full_name: `طبيب ${id}`,
  license_number: "100",
  license_region: "IL",
  license_verification_status: "verified",
  secondary_license_number: null,
  secondary_license_region: null,
  secondary_license_verification_status: null,
  ...over,
});
const rows = (...n: number[]) => n.map((license_number) => ({ license_number }));
/** The audit read: a recent full sweep means tonight is the short run. */
const recentFull = { data: [{ id: "a" }] };

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("CRON_SECRET", "s3cret");
});

describe("GET /api/cron/sync-moh", () => {
  it("refuses a request without the cron secret before touching the registry", async () => {
    expect((await call(null)).status).toBe(401);
    expect(db.argsOf("doctors", "select")).toEqual([]);
    expect(client.findAll).not.toHaveBeenCalled();
  });

  it("asks only for our doctors' licences on an ordinary night", async () => {
    db.queue("doctors", { data: [doctor("d1"), doctor("d2", { license_number: "200", secondary_license_number: "300", secondary_license_region: "IL" }), doctor("d3", { license_region: "PS" })] });
    db.queue("audit_logs", recentFull);
    client.findByLicenses.mockResolvedValue(rows(100, 200, 300));
    const body = await (await call()).json();
    expect(body).toMatchObject({ ok: true, scope: "ours", rows_upserted: 3, missing: 0, flagged: 0, requests: 3 });
    expect(client.findByLicenses).toHaveBeenCalledWith([100, 200, 300]);
    expect(saveRegistryRows).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "moh_sync_completed" }));
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("flags a licence the registry dropped, once, and raises one alert naming who", async () => {
    db.queue("doctors", { data: [doctor("d1"), doctor("d2", { license_number: "200", license_verification_status: "not_found" }), doctor("d3", { license_number: "300", secondary_license_number: "301", secondary_license_region: "IL", secondary_license_verification_status: "verified" })] });
    db.queue("audit_logs", recentFull);
    client.findByLicenses.mockResolvedValue(rows(300));
    const body = await (await call()).json();
    // d1's primary and d3's secondary are new; d2 was already flagged.
    expect(body).toMatchObject({ missing: 3, flagged: 2 });
    expect(db.argsOf("doctors", "update")).toEqual([[{ license_verification_status: "not_found" }], [{ secondary_license_verification_status: "not_found" }]]);
    expect(db.argsOf("moh_practitioners", "in")).toEqual([["license_number", [100, 200, 301]]]);
    expect(raiseAlert).toHaveBeenCalledWith(expect.anything(), "licenses_missing", expect.objectContaining({ extra: expect.objectContaining({ flagged: 2 }) }));
  });

  it("does a full sweep when none finished this week, and prunes what the registry dropped", async () => {
    db.queue("doctors", { data: [doctor("d1")] });
    db.queue("audit_logs", { data: [] });
    db.queue("moh_practitioners", { count: 3 });
    client.findAll.mockResolvedValue(rows(100, 5, 6));
    const body = await (await call()).json();
    expect(body).toMatchObject({ scope: "full", rows_upserted: 3 });
    expect(db.argsOf("moh_practitioners", "lt")[0][0]).toBe("synced_at");
  });

  it("does not trust a sweep that shrank the copy", async () => {
    db.queue("doctors", { data: [doctor("d1")] });
    db.queue("audit_logs", { data: [] });
    db.queue("moh_practitioners", { count: 50_000 });
    client.findAll.mockResolvedValue(rows(100));
    const res = await call();
    expect(res.status).toBe(500);
    expect(saveRegistryRows).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "moh_sync_failed", metadata: expect.objectContaining({ error: expect.stringContaining("registry sweep returned 1") }) }));
  });

  it("does not trust an answer missing over half of our licences", async () => {
    db.queue("doctors", { data: Array.from({ length: 12 }, (_, i) => doctor(`d${i}`, { license_number: String(100 + i) })) });
    db.queue("audit_logs", recentFull);
    client.findByLicenses.mockResolvedValue(rows(100));
    expect((await call()).status).toBe(500);
    expect(db.argsOf("doctors", "update")).toEqual([]);
  });

  it.each([
    ["the doctors cannot be read", () => db.queue("doctors", { error: { message: "boom" } }), "doctors read failed: boom"],
    ["the activity log cannot be read", () => { db.queue("doctors", { data: [] }); db.queue("audit_logs", { error: { message: "boom" } }); }, "audit read failed: boom"],
    ["the copy cannot be counted", () => { db.queue("doctors", { data: [] }); db.queue("audit_logs", { data: [] }); db.queue("moh_practitioners", { error: { message: "boom" } }); client.findAll.mockResolvedValue([]); }, "count failed: boom"],
    ["pruning fails", () => { db.queue("doctors", { data: [doctor("d1")] }); db.queue("audit_logs", recentFull); db.queue("moh_practitioners", { error: { message: "boom" } }); client.findByLicenses.mockResolvedValue([]); }, "prune failed: boom"],
    ["flagging fails", () => { db.queue("doctors", { data: [doctor("d1")] }, { error: { message: "boom" } }); db.queue("audit_logs", recentFull); client.findByLicenses.mockResolvedValue([]); }, "flag failed: boom"],
  ])("records a failure when %s", async (_, arrange, message) => {
    arrange();
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "sync_failed" });
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata: expect.objectContaining({ error: expect.stringContaining(message) }) }));
  });

  it("records a failure whose cause is not an Error", async () => {
    db.queue("doctors", { data: [doctor("d1")] });
    db.queue("audit_logs", recentFull);
    client.findByLicenses.mockRejectedValue("plain text");
    await call();
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata: expect.objectContaining({ error: "plain text", requests: 3 }) }));
  });

  it("counts no requests when the failure came before the client existed", async () => {
    db.queue("doctors", { error: { message: "boom" } });
    await call();
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata: expect.objectContaining({ requests: 0 }) }));
  });
});
