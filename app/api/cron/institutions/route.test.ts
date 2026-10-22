import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/test/fakeSupabase";

const { relinkWorkplaces, captureMessage } = vi.hoisted(() => ({
  relinkWorkplaces: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage, captureException: vi.fn() }));
vi.mock("@/lib/institutions", () => ({ relinkWorkplaces }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const call = async (auth?: string) => {
  const { GET } = await import("./route");
  return GET(new Request("https://example.test/api/cron/institutions", { headers: auth ? { authorization: auth } : {} }));
};

describe("GET /api/cron/institutions", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "s3cret");
  });

  it("refuses without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect(relinkWorkplaces).not.toHaveBeenCalled();
  });

  it("re-links and tells the developers about unclaimed names", async () => {
    relinkWorkplaces.mockResolvedValue({ changed: 2, unmatched: [{ name: "هداسا", count: 1 }] });
    const res = await call("Bearer s3cret");
    expect(await res.json()).toEqual({ ok: true, changed: 2, unmatched: 1 });
    expect(captureMessage).toHaveBeenCalledWith(
      "Workplace names not in the institutions list",
      expect.objectContaining({ extra: { count: 1, institutions: [{ name: "هداسا", count: 1 }] } }),
    );
  });

  it("stays quiet when every name is claimed", async () => {
    relinkWorkplaces.mockResolvedValue({ changed: 0, unmatched: [] });
    await call("Bearer s3cret");
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
