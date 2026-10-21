// rateLimit: Upstash in production, an in-process counter in dev, and fail
// closed on a misconfigured caller.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.hoisted(() => vi.fn());
const ctor = vi.hoisted(() => vi.fn());

vi.mock("@upstash/redis", () => ({ Redis: vi.fn() }));
const { captureMessage, raiseAlert } = vi.hoisted(() => ({ captureMessage: vi.fn(), raiseAlert: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/alerts", async (orig) => ({ ...(await orig<typeof import("@/lib/alerts")>()), raiseAlert }));
vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow = vi.fn((n: number, w: string) => `${n}/${w}`);
    constructor(opts: unknown) {
      ctor(opts);
    }
    limit = limit;
  }
  return { Ratelimit };
});

const load = async () => {
  vi.resetModules();
  return (await import("./ratelimit")).rateLimit;
};

describe("rateLimit", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("counts locally in dev until the window budget is spent", async () => {
    const rateLimit = await load();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit("loginStart", "ip:1"));
    expect(results.map((r) => r.success)).toEqual([true, true, true, true]);
    expect(results.map((r) => r.remaining)).toEqual([4, 3, 2, 1]);
    await rateLimit("loginStart", "ip:1");
    expect((await rateLimit("loginStart", "ip:1")).success).toBe(false);
    // Buckets are per identifier.
    expect((await rateLimit("loginStart", "ip:2")).success).toBe(true);
  });

  it("starts a fresh window once the old one expires", async () => {
    vi.useFakeTimers();
    try {
      const rateLimit = await load();
      for (let i = 0; i < 5; i++) await rateLimit("loginVerify", "d"); // 5 per 10 m
      expect((await rateLimit("loginVerify", "d")).success).toBe(false);
      vi.advanceTimersByTime(601_000);
      expect((await rateLimit("loginVerify", "d")).success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sizes hour and minute windows", async () => {
    const rateLimit = await load();
    const now = Date.now();
    const signup = await rateLimit("signupStart", "x"); // 1 h
    const verify = await rateLimit("signupVerify", "x"); // 10 m
    expect(signup.reset - now).toBeGreaterThanOrEqual(3_600_000);
    expect(verify.reset - now).toBeGreaterThanOrEqual(600_000);
    expect(verify.reset - now).toBeLessThan(3_600_000);
  });

  it("fails closed on an empty identifier in production only", async () => {
    let rateLimit = await load();
    expect((await rateLimit("search", "")).success).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    rateLimit = await load();
    expect((await rateLimit("search", "")).success).toBe(false);
  });

  it("refuses to run without Upstash in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const rateLimit = await load();
    await expect(rateLimit("search", "d")).rejects.toThrow(/UPSTASH/);
  });

  it("uses one Upstash limiter per key when configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    limit.mockResolvedValue({ success: false, limit: 30, remaining: 0, reset: 5, pending: null });
    const rateLimit = await load();
    expect(await rateLimit("search", "d")).toEqual({ success: false, limit: 30, remaining: 0, reset: 5 });
    await rateLimit("search", "e");
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ prefix: "rl:search", limiter: "30/1 m" }));
  });

  it("lets a request through when Redis is slow, alerting admins at most once an hour", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-21T08:00:00Z") });
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
      limit.mockResolvedValue({ success: true, limit: 30, remaining: 29, reset: 5, reason: "timeout" });
      const rateLimit = await load();

      expect((await rateLimit("search", "d")).success).toBe(true);
      expect(raiseAlert).toHaveBeenCalledTimes(1);
      expect(raiseAlert).toHaveBeenCalledWith(expect.anything(), "ratelimit_timeout", expect.anything());

      // Two minutes on: Sentry hears again, the admin list does not.
      vi.advanceTimersByTime(2 * 60_000);
      await rateLimit("search", "d");
      expect(captureMessage).toHaveBeenCalledTimes(1);
      expect(raiseAlert).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(60 * 60_000);
      await rateLimit("search", "d");
      expect(raiseAlert).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
