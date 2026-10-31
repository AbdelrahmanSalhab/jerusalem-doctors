// One text per code, even when Supabase retries the Send SMS hook.
//
// Supabase gives the hook about five seconds, then retries it (up to three
// times, two seconds apart). A send that was slow but went through would then
// go out again: the doctor gets the same code twice, and we pay twice. The
// hook marks each (phone, code) once its text is out, and a call for a marked
// pair is answered without sending. Keyed on the pair, not on the delivery's
// id, because the same phone getting the same code twice is a duplicate
// whatever id each call carries.
//
// The key is an HMAC with the hook's secret, so Redis never holds a code, nor
// anything a six-digit code could be worked back out of.
//
// Upstash Redis in production (the rate limiter's), memory locally. Any Redis
// failure lets the text go out: a duplicate is better than no code.

import { createHmac } from "node:crypto";
import { Redis } from "@upstash/redis";

const TTL_SECONDS = 600;
const PREFIX = "sms-hook-sent:";
const local = new Map<string, number>();

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

/** The pair's key; `secret` is SEND_SMS_HOOK_SECRET (unset only in dev). */
export function sentKey(phoneE164: string, code: string, secret = ""): string {
  return PREFIX + createHmac("sha256", secret).update(`${phoneE164}:${code}`).digest("hex");
}

/** Whether this code's text already went to this phone. */
export async function alreadySent(key: string): Promise<boolean> {
  const r = redis();
  if (!r) return (local.get(key) ?? 0) > Date.now();
  try {
    return (await r.exists(key)) === 1;
  } catch {
    return false;
  }
}

/** Records that this code's text went to this phone. */
export async function markSent(key: string): Promise<void> {
  const r = redis();
  if (!r) {
    local.set(key, Date.now() + TTL_SECONDS * 1000);
    return;
  }
  try {
    await r.set(key, 1, { ex: TTL_SECONDS });
  } catch {
    // A retry may then send again; nothing worse.
  }
}

/**
 * True the first time a key is claimed within `ttlSeconds`, false after. For
 * counting something once when its sender may report it again (SMS4FREE's
 * delivery reports). A Redis failure counts it: a double is better than a gap.
 */
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
  const r = redis();
  if (!r) {
    const now = Date.now();
    if ((local.get(key) ?? 0) > now) return false;
    local.set(key, now + ttlSeconds * 1000);
    return true;
  }
  try {
    return (await r.set(key, 1, { nx: true, ex: ttlSeconds })) === "OK";
  } catch {
    return true;
  }
}
