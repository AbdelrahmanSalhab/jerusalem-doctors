// How many different colleagues' numbers one account may reveal in a day (#16).
//
// The registry is public, so an account an admin accepted may still belong to
// someone who only typed a real doctor's name and licence. What such an account
// can take is bounded here: a search returns no numbers or emails, one is
// shown when a doctor taps it, and each account has a budget of distinct
// doctors a day. Revealing the same doctor again costs nothing. Real use is
// well under it: at most 8 contacts in any doctor-day over the 30 days before
// this was written (2026-11-05), so the budget is for a copier, not a user.
//
// Upstash Redis in production (the rate limiter's), memory locally. A Redis
// failure lets the reveal through, like the rate limiter does.

import { Redis } from "@upstash/redis";

/** Distinct doctors a day. Newer accounts get the smaller one. */
export const REVEAL_BUDGET = { established: 25, recent: 10 } as const;
/** An account is recent for this long after an admin accepted it. */
export const RECENT_DAYS = 14;

const TTL_SECONDS = 2 * 86_400;
const local = new Map<string, Set<string>>();

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token, responseEncoding: "base64" }) : null;
}

/** The day's budget for an account accepted at `approvedAt` (null: unknown, so the smaller). */
export function revealLimit(approvedAt: string | null, now = Date.now()): number {
  const since = approvedAt ? Date.parse(approvedAt) : NaN;
  return Number.isFinite(since) && now - since >= RECENT_DAYS * 86_400_000 ? REVEAL_BUDGET.established : REVEAL_BUDGET.recent;
}

export interface RevealResult {
  allowed: boolean;
  /** Different doctors revealed today, this one included when allowed. */
  used: number;
  limit: number;
}

/** Counts a reveal of `targetId` by `viewerId` against today's (UTC) budget. */
export async function countReveal(viewerId: string, targetId: string, limit: number, now = new Date()): Promise<RevealResult> {
  const key = `reveal:${viewerId}:${now.toISOString().slice(0, 10)}`;
  const r = redis();
  if (!r) {
    const seen = local.get(key) ?? new Set<string>();
    local.set(key, seen);
    if (seen.has(targetId)) return { allowed: true, used: seen.size, limit };
    if (seen.size >= limit) return { allowed: false, used: seen.size, limit };
    seen.add(targetId);
    return { allowed: true, used: seen.size, limit };
  }
  try {
    const added = await r.sadd(key, targetId);
    const used = await r.scard(key);
    if (added === 1 && used > limit) {
      await r.srem(key, targetId);
      return { allowed: false, used: used - 1, limit };
    }
    if (added === 1) await r.expire(key, TTL_SECONDS);
    return { allowed: true, used, limit };
  } catch {
    return { allowed: true, used: 0, limit };
  }
}
