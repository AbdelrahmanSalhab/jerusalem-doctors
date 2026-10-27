// One text per code, even when Supabase retries the Send SMS hook.
//
// Supabase gives the hook about five seconds, then retries it (up to three
// times, two seconds apart) with the same `webhook-id`. A send that was slow
// but went through would then go out again: the doctor gets the same code
// twice, and we pay twice. The hook marks an id once its text is out, and a
// retry of a marked id is answered without sending.
//
// Upstash Redis in production (the rate limiter's), memory locally. Any Redis
// failure lets the text go out: a duplicate is better than no code.

import { Redis } from "@upstash/redis";

const TTL_SECONDS = 600;
const PREFIX = "sms-hook-sent:";
const local = new Map<string, number>();

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

/** Whether this hook delivery's text already went out. */
export async function alreadySent(webhookId: string): Promise<boolean> {
  const r = redis();
  if (!r) return (local.get(webhookId) ?? 0) > Date.now();
  try {
    return (await r.exists(PREFIX + webhookId)) === 1;
  } catch {
    return false;
  }
}

/** Records that this hook delivery's text went out. */
export async function markSent(webhookId: string): Promise<void> {
  const r = redis();
  if (!r) {
    local.set(webhookId, Date.now() + TTL_SECONDS * 1000);
    return;
  }
  try {
    await r.set(PREFIX + webhookId, 1, { ex: TTL_SECONDS });
  } catch {
    // A retry may then send again; nothing worse.
  }
}
