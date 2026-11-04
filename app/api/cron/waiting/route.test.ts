// The morning reminder to every admin about doctors who have waited a day.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { raiseAlert, waiting } = vi.hoisted(() => ({
  raiseAlert: vi.fn(async () => {}),
  waiting: { count: 0 as number | null, filters: [] as [string, unknown][] },
}));
vi.mock("@/lib/alerts", () => ({ raiseAlert }));
vi.mock("@/lib/api/cronAuth", () => ({ verifyCronAuth: () => null }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => {
        const q: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ count: waiting.count, error: null }).then(ok) };
        for (const m of ["eq", "lt", "gte"]) q[m] = (col: string, v: unknown) => (waiting.filters.push([col, v]), q);
        return q;
      },
    }),
  }),
}));

const run = async () => (await import("./route")).GET(new Request("https://x.test/api/cron/waiting"));

beforeEach(() => {
  vi.clearAllMocks();
  waiting.count = 0;
  waiting.filters = [];
});

describe("GET /api/cron/waiting", () => {
  it("stays quiet when nobody has waited a day", async () => {
    expect((await (await run()).json()).waiting).toBe(0);
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("tells the admins once about the doctors who crossed 24 hours since the last run", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T06:00:00Z") });
    try {
      waiting.count = 2;
      const body = await (await run()).json();
      expect(raiseAlert).toHaveBeenCalledWith(expect.anything(), "doctor_waiting_long", { extra: { waiting: 2 } });
      expect(body).toMatchObject({ waiting: 2 });
      // Active, not accepted, not staff, 24 to 48 hours old: a day's window, so no doctor twice.
      expect(waiting.filters).toEqual(
        expect.arrayContaining([
          ["is_active", true],
          ["is_admin_approved", false],
          ["is_admin", false],
          ["created_at", "2026-11-04T06:00:00.000Z"],
          ["created_at", "2026-11-03T06:00:00.000Z"],
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
