// SMS4FREE's delivery reports: whether each code text reached the phone, and
// how long it took. Doctors reported codes that "didn't work" while a code
// lived 60 seconds; this says whether texts arrive in time.
//
// Each send carries `returnUrl` and `usermsgid`; SMS4FREE then POSTs
// `to`, `status` (1 delivered, 5 not delivered, 6 kosher number: the code
// was read in a voice call) and `msgId` to the URL, form-encoded
// (sms4free.co.il/docs/otp-api.html). Delivery reports may be a paid
// feature of the account; without it, none arrive and nothing breaks.
//
// SMS4FREE signs nothing, so the URL carries a key derived from the hook's
// secret: only a caller that knows it can file a report. The message id
// carries its own send time, so no store is needed to time the delivery.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const DELIVERY_PATH = "/api/sms/delivery";

/** SMS4FREE's report status → our usage kind. */
export const DELIVERY_STATUS = { "1": "sms_delivered", "5": "sms_undelivered", "6": "sms_voice" } as const;

/** The URL's key: an HMAC of the hook's secret, never the secret itself. */
export function deliveryKey(secret: string): string {
  return createHmac("sha256", secret).update("sms4free-delivery-report").digest("hex").slice(0, 32);
}

export function validDeliveryKey(key: string | null, secret: string | undefined): boolean {
  if (!key || !secret) return false;
  const want = Buffer.from(deliveryKey(secret));
  const got = Buffer.from(key);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Where SMS4FREE should report, or null when reports are off: no secret,
 *  or no production address (SMS_DELIVERY_BASE_URL overrides, for e2e). */
export function deliveryUrl(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.SEND_SMS_HOOK_SECRET;
  const base =
    env.SMS_DELIVERY_BASE_URL ??
    (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  return secret && base ? `${base}${DELIVERY_PATH}?k=${deliveryKey(secret)}` : null;
}

/** "<send time in ms>-<random>": the report's msgId gives the delay back. */
export const newMessageId = (now: number = Date.now()) => `${now}-${randomBytes(4).toString("hex")}`;

/** Seconds from send to report, or null for an id that isn't ours. */
export function deliveryDelaySeconds(msgId: string | null, now: number = Date.now()): number | null {
  const sent = Number(msgId?.match(/^(\d{13})-[0-9a-f]{8}$/)?.[1]);
  return Number.isFinite(sent) && sent > 0 && sent <= now ? Math.round((now - sent) / 1000) : null;
}
