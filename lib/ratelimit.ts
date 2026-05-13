// Sliding-window rate limiter on top of Upstash Redis.
//
// Dev / local fallback: when the Upstash env vars are unset, fall back to a
// single-process in-memory limiter so signup flows still work end-to-end on
// localhost. The fallback is per-process — fine for development, not for
// production. Production startup fails loudly if the env is missing.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type WindowSpec = `${number} ${"s" | "m" | "h" | "d"}`;
type LimitDef = { limit: number; window: WindowSpec };

export const RATE_LIMITS = {
  signupStart: { limit: 3, window: "1 h" },
  signupStartNotFound: { limit: 3, window: "1 h" },
  signupEmailStart:    { limit: 5, window: "1 h" },
  signupEmailVerify:   { limit: 10, window: "1 h" },
  signupVerify: { limit: 5, window: "10 m" },
  signupCheckLicense: { limit: 10, window: "1 h" },
  signupCheckUnique: { limit: 30, window: "1 h" },
  loginStart: { limit: 5, window: "1 h" },
  loginVerify: { limit: 5, window: "10 m" },
  search: { limit: 30, window: "1 m" },
  profilePatch: { limit: 10, window: "1 h" },
} as const satisfies Record<string, LimitDef>;

export type RateLimitKey = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // unix ms when budget resets
}

const redisFromEnv = (): Redis | null => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
};

const upstashLimiters = new Map<RateLimitKey, Ratelimit>();
const localCounters = new Map<string, { count: number; resetAt: number }>();

function getUpstashLimiter(key: RateLimitKey, redis: Redis): Ratelimit {
  let limiter = upstashLimiters.get(key);
  if (limiter) return limiter;
  const def = RATE_LIMITS[key];
  limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(def.limit, def.window),
    prefix: `rl:${key}`,
    analytics: false,
  });
  upstashLimiters.set(key, limiter);
  return limiter;
}

function localFallback(
  key: RateLimitKey,
  identifier: string,
): RateLimitResult {
  const def = RATE_LIMITS[key];
  const ms = parseWindowMs(def.window);
  const id = `${key}:${identifier}`;
  const now = Date.now();
  const entry = localCounters.get(id);
  if (!entry || entry.resetAt <= now) {
    localCounters.set(id, { count: 1, resetAt: now + ms });
    return { success: true, limit: def.limit, remaining: def.limit - 1, reset: now + ms };
  }
  entry.count += 1;
  const remaining = Math.max(0, def.limit - entry.count);
  return {
    success: entry.count <= def.limit,
    limit: def.limit,
    remaining,
    reset: entry.resetAt,
  };
}

function parseWindowMs(window: WindowSpec): number {
  const [n, u] = window.split(" ") as [string, "s" | "m" | "h" | "d"];
  const mult = u === "s" ? 1_000 : u === "m" ? 60_000 : u === "h" ? 3_600_000 : 86_400_000;
  return Number(n) * mult;
}

/**
 * Apply a rate limit to `identifier` (typically `${key}:${ip}` or `${key}:${phone}`).
 * Returns success=false when budget exhausted; caller handles 429.
 */
export async function rateLimit(
  key: RateLimitKey,
  identifier: string,
): Promise<RateLimitResult> {
  if (!identifier) {
    // Defensive: an empty identifier means "every caller shares one bucket"
    // — almost certainly a bug. Fail closed in production, allow in dev.
    if (process.env.NODE_ENV === "production") {
      return { success: false, limit: 0, remaining: 0, reset: Date.now() };
    }
    return { success: true, limit: Infinity, remaining: Infinity, reset: 0 };
  }

  const redis = redisFromEnv();
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "rateLimit: UPSTASH_REDIS_REST_URL / TOKEN required in production",
      );
    }
    return localFallback(key, identifier);
  }

  const limiter = getUpstashLimiter(key, redis);
  const r = await limiter.limit(identifier);
  return {
    success: r.success,
    limit: r.limit,
    remaining: r.remaining,
    reset: r.reset,
  };
}
