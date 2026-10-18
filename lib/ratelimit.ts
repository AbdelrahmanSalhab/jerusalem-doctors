// Sliding-window rate limiter on top of Upstash Redis.
//
// Dev / local fallback: when the Upstash env vars are unset, fall back to a
// single-process in-memory limiter so signup flows still work end-to-end on
// localhost. The fallback is per-process, fine for development, not for
// production. Production fails loudly if the env is missing; a Redis timeout
// lets the request through (see rateLimit).

import * as Sentry from "@sentry/nextjs";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type WindowSpec = `${number} ${"s" | "m" | "h" | "d"}`;
type LimitDef = { limit: number; window: WindowSpec };

// Per-phone / per-session limits are the real brake on OTP guessing and SMS
// spend. The per-IP ones only stop a single machine flooding: a hospital or
// event Wi-Fi puts many doctors behind one NAT address, so they must be far
// looser than the per-phone ones, or the fourth doctor to sign up there in an
// hour is locked out.
export const RATE_LIMITS = {
  signupStart: { limit: 3, window: "1 h" },
  signupStartIp: { limit: 30, window: "1 h" },
  signupVerify: { limit: 5, window: "10 m" },
  signupVerifyIp: { limit: 50, window: "10 m" },
  signupResend: { limit: 3, window: "10 m" },
  signupResendIp: { limit: 20, window: "10 m" },
  signupCheckLicense: { limit: 100, window: "1 h" },
  signupCheckUnique: { limit: 200, window: "1 h" },
  loginStart: { limit: 5, window: "1 h" },
  loginStartIp: { limit: 30, window: "1 h" },
  loginVerify: { limit: 5, window: "10 m" },
  loginVerifyIp: { limit: 50, window: "10 m" },
  loginResend: { limit: 3, window: "10 m" },
  loginResendIp: { limit: 20, window: "10 m" },
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
let lastTimeoutReport = 0;
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
  // ponytail: a slow Redis (no answer within @upstash/ratelimit's 5 s) lets
  // the request through, so a slowdown doesn't lock doctors out; Turnstile and
  // Supabase's own limits still stand. A hard Upstash error (DNS, 5xx) makes
  // limit() throw instead, and the route answers 500. Reported at most once a
  // minute per instance so an outage doesn't flood Sentry.
  if (r.reason === "timeout") {
    console.error(`[ratelimit] ${key} timed out, request allowed`);
    if (Date.now() - lastTimeoutReport > 60_000) {
      lastTimeoutReport = Date.now();
      Sentry.captureMessage("Rate limiter timed out (fail-open)", { level: "warning", tags: { key } });
    }
  }
  return {
    success: r.success,
    limit: r.limit,
    remaining: r.remaining,
    reset: r.reset,
  };
}
