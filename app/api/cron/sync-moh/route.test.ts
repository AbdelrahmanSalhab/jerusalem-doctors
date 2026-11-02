// The registry refresh is the heaviest cron job; its door is the secret.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

describe("GET /api/cron/sync-moh", () => {
  it("refuses a request without the cron secret before touching the registry", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { db } = await import("@/test/fakeSupabase");
    db.reset();
    const res = await (await import("./route")).GET(new Request("http://x/api/cron/sync-moh"));
    expect(res.status).toBe(401);
    expect(db.argsOf("doctors", "select")).toEqual([]);
  });
});
