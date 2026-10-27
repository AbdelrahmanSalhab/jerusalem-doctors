// POST /api/auth/hooks/send-otp
//
// Supabase Auth's "Send SMS Hook". Supabase generates, stores, and later
// verifies the OTP itself; it calls this endpoint purely to deliver the code.
// We deliver over SMS via the SMS4FREE API.
//
// proxy.ts treats all of /api/ as public, so the Standard Webhooks signature
// is the ONLY authentication on this route. Never relax that check.
//
// The OTP value must never reach a log line, an error message, or Sentry.

import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { isPhoneAuthDisabled } from "@/lib/auth/session";
import { getOtpSender, OtpProviderError } from "@/lib/otp";
import { isKnownRecipient } from "@/lib/otp/recipients";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { raiseAlert } from "@/lib/alerts";
import { alreadySent, markSent, sentKey } from "@/lib/otp/sentOnce";
import { verifySendSmsHook } from "@/lib/otp/webhook";
import { recordEvent } from "@/lib/usage";

// nodejs is already the default in Next 16, but webhook.ts needs node:crypto:
// pin it so a future default flip to edge can't silently break signing.
export const runtime = "nodejs";

interface SendSmsHookPayload {
  user?: { phone?: string };
  sms?: { otp?: string };
}

/**
 * Answer with a JSON body on every path.
 *
 * Supabase's hook runner inspects the Content-Type of our response and fails
 * the whole OTP request with `hook_payload_invalid_content_type` when it is
 * missing, which `new Response(null, ...)` does not set. The doctor then sees
 * a generic error on /login and /signup and never gets a code, even though the
 * SMS itself went out fine. The body content is irrelevant; the header is not.
 */
function hookResponse(status: number, headers?: HeadersInit): Response {
  return Response.json({}, { status, headers });
}

/** Supabase stores phones without a leading +; the Meta sender wants E.164. */
function toE164(phone: string): string {
  return phone.startsWith("+") ? phone : `+${phone}`;
}

export async function POST(req: Request) {
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    // Fail closed in production, same posture as lib/turnstile.ts and
    // lib/ratelimit.ts. Locally, allow unsigned calls so a tunnelled dev
    // Supabase project can drive the flow before the secret is issued.
    if (isProd) {
      Sentry.captureException(
        new Error("SEND_SMS_HOOK_SECRET is unset in production"),
      );
      return hookResponse(500);
    }
    console.error("[send-otp] SEND_SMS_HOOK_SECRET unset, skipping signature check (dev only)");
  }

  // Read the raw bytes BEFORE parsing: the signature covers the exact body,
  // and a re-serialized JSON object will not match.
  const rawBody = await req.text();

  if (secret && !verifySendSmsHook(rawBody, req.headers, secret)) {
    return hookResponse(401);
  }

  // The kill switch, enforced where every SMS passes. The app routes also
  // refuse, but a bot can ask Supabase Auth for an OTP directly with the
  // public anon key, which reaches this hook without touching them. 400
  // so Supabase doesn't retry.
  if (isPhoneAuthDisabled()) return hookResponse(400);

  let payload: SendSmsHookPayload;
  try {
    payload = JSON.parse(rawBody) as SendSmsHookPayload;
  } catch {
    return hookResponse(400);
  }

  const phone = payload.user?.phone;
  const code = payload.sms?.otp;
  if (!phone || !code) {
    Sentry.captureException(
      new Error("Send SMS hook payload missing user.phone or sms.otp"),
    );
    return hookResponse(400);
  }

  const e164 = toE164(phone);

  // This code already went to this phone (a retry after a slow send): answer,
  // don't send it again (lib/otp/sentOnce.ts). Before the checks below, so a
  // duplicate costs nothing.
  const once = sentKey(e164, code, secret);
  if (await alreadySent(once)) {
    console.warn("[send-otp] this code already went to this phone, not sent again");
    return hookResponse(200);
  }

  // Only a registered doctor or a number mid-signup (lib/otp/recipients.ts).
  // 400: Supabase must not retry a number that will never qualify.
  let known: boolean;
  try {
    known = await isKnownRecipient(createSupabaseServiceClient(), e164);
  } catch (err) {
    console.error("[send-otp] recipient check failed:", (err as Error)?.message);
    Sentry.captureException(err);
    return hookResponse(500);
  }
  if (!known) {
    console.warn("[send-otp] refused: no account or signup for this number");
    return hookResponse(400);
  }

  // The site-wide daily budget, after the checks above so refused numbers
  // do not spend it.
  const budget = await rateLimit("smsDaily", "all");
  // One warning as the day crosses half the budget, while there is still
  // room to raise SMS_DAILY_CAP before signups and logins stop.
  // ponytail: fires on the exact crossing; two codes landing together could
  // skip it, and then the cap alert below is the one that arrives.
  if (budget.success && budget.remaining === Math.floor(budget.limit / 2)) {
    console.warn(`[send-otp] half the daily SMS budget used (${budget.limit - budget.remaining} of ${budget.limit})`);
    await raiseAlert(createSupabaseServiceClient(), "sms_half_budget", { extra: { limit: budget.limit } });
  }
  if (!budget.success) {
    console.error("[send-otp] daily SMS cap reached; no codes until it resets");
    await raiseAlert(createSupabaseServiceClient(), "sms_cap_reached", { extra: { limit: budget.limit } });
    return hookResponse(400);
  }

  try {
    const sender = getOtpSender();
    const started = Date.now();
    await sender.send(e164, code);
    // How long SMS4FREE took to accept it: tunes the 4 s timeout from data.
    const ms = Date.now() - started;
    // Before answering: Supabase's retry comes seconds later and must see it.
    await markSent(once);
    // Counted after answering: Supabase waits on this hook.
    after(() => recordEvent(createSupabaseServiceClient(), "sms_sent", { meta: { ms } }));
    return hookResponse(200);
  } catch (err) {
    // OtpProviderError messages carry Meta's error code and message, never
    // the OTP, Meta does not echo it back and we never interpolate it.
    // Log as well as report: Sentry no-ops without a DSN, and a silent
    // delivery failure is the worst possible failure mode here.
    console.error("[send-otp] delivery failed:", (err as Error)?.message);
    Sentry.captureException(err);
    const permanent = err instanceof OtpProviderError && err.permanent;
    // Supabase retries a hook only on 429 or 503 with a non-empty
    // retry-after, up to three times two seconds apart, all within its 5 s
    // budget (supabase.com/docs/guides/auth/auth-hooks). A 500 is never
    // retried, so a transient failure answers 503: the retry then gets the
    // doctor a code. A permanent one (config, balance) answers 400.
    return permanent ? hookResponse(400) : hookResponse(503, { "retry-after": "2" });
  }
}
