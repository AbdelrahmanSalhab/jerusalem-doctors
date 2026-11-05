// The daily metrics job records yesterday and alerts past 70% of the
// database's free-plan size.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, raiseAlert, purgeUnfinished } = vi.hoisted(() => ({
  rpc: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: { db_bytes: 0 }, error: null })),
  raiseAlert: vi.fn(async () => {}),
  purgeUnfinished: vi.fn(async () => 2),
}));
vi.mock("@/lib/signup/unfinished", () => ({ purgeUnfinished }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc }) }));
vi.mock("@/lib/alerts", () => ({ raiseAlert }));
vi.mock("@/lib/api/cronAuth", () => ({ verifyCronAuth: () => null }));

const MB = 1024 * 1024;
const run = async () => (await import("./route")).GET(new Request("https://x.test/api/cron/metrics"));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/cron/metrics", () => {
  it("records the UTC day that just ended", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-21T00:30:00Z") });
    try {
      const body = await (await run()).json();
      expect(rpc).toHaveBeenCalledWith("record_daily_metrics", { p_day: "2026-10-20" });
      expect(body).toMatchObject({ ok: true, day: "2026-10-20" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes unfinished signups past their 30 days", async () => {
    const body = await (await run()).json();
    expect(purgeUnfinished).toHaveBeenCalledOnce();
    expect(body).toMatchObject({ unfinished_deleted: 2 });
  });

  it("stays quiet below 70% of the database limit", async () => {
    rpc.mockResolvedValueOnce({ data: { db_bytes: 349 * MB }, error: null });
    await run();
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("alerts past 70% of the database limit", async () => {
    rpc.mockResolvedValueOnce({ data: { db_bytes: 351 * MB }, error: null });
    await run();
    expect(raiseAlert).toHaveBeenCalledWith(expect.anything(), "db_size_high", {
      extra: { db_bytes: 351 * MB, limit_bytes: 500 * MB },
    });
  });

  it("fails loudly when the snapshot cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await run()).status).toBe(500);
  });
});
