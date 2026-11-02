// With Redis configured: the same answers, and what a Redis failure means for
// each (a retry may send twice; a delivery report is counted rather than lost).

import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({ exists: vi.fn(), set: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: class { exists = redis.exists; set = redis.set; } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
});

describe("with Redis", () => {
  it("asks Redis whether a code's text already went out, and records it with a lifetime", async () => {
    const { alreadySent, markSent } = await import("./sentOnce");
    redis.exists.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await alreadySent("k")).toBe(true);
    expect(await alreadySent("k")).toBe(false);
    await markSent("k");
    expect(redis.set).toHaveBeenCalledWith("k", 1, { ex: 600 });
  });

  it("treats a Redis failure as not sent yet, and carries on after a failed record", async () => {
    const { alreadySent, markSent } = await import("./sentOnce");
    redis.exists.mockRejectedValueOnce(new Error("down"));
    expect(await alreadySent("k")).toBe(false);
    redis.set.mockRejectedValueOnce(new Error("down"));
    await expect(markSent("k")).resolves.toBeUndefined();
  });

  it("claims a key once, and counts it when Redis fails", async () => {
    const { claimOnce } = await import("./sentOnce");
    redis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("down"));
    expect(await claimOnce("c", 30)).toBe(true);
    expect(await claimOnce("c", 30)).toBe(false);
    expect(await claimOnce("c", 30)).toBe(true);
    expect(redis.set).toHaveBeenCalledWith("c", 1, { nx: true, ex: 30 });
  });
});
