// POST /api/auth/hooks/send-otp
//
// Supabase Auth's "Send SMS Hook". Supabase generates, stores, and later
// verifies the OTP itself; it calls this endpoint purely to deliver the code.
// We deliver over WhatsApp via the Meta Cloud API.
//
// proxy.ts treats all of /api/ as public, so the Standard Webhooks signature
// is the ONLY authentication on this route. Never relax that check.
//
// The OTP value must never reach a log line, an error message, or Sentry.

import * as Sentry from "@sentry/nextjs";
import { getOtpSender, OtpProviderError } from "@/lib/otp";
import { verifySendSmsHook } from "@/lib/otp/webhook";

// nodejs is already the default in Next 16, but webhook.ts needs node:crypto —
// pin it so a future default flip to edge can't silently break signing.
export const runtime = "nodejs";

interface SendSmsHookPayload {
  user?: { phone?: string };
  sms?: { otp?: string };
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
      return new Response(null, { status: 500 });
    }
    console.error("[send-otp] SEND_SMS_HOOK_SECRET unset — skipping signature check (dev only)");
  }

  // Read the raw bytes BEFORE parsing: the signature covers the exact body,
  // and a re-serialized JSON object will not match.
  const rawBody = await req.text();

  if (secret && !verifySendSmsHook(rawBody, req.headers, secret)) {
    return new Response(null, { status: 401 });
  }

  let payload: SendSmsHookPayload;
  try {
    payload = JSON.parse(rawBody) as SendSmsHookPayload;
  } catch {
    return new Response(null, { status: 400 });
  }

  const phone = payload.user?.phone;
  const code = payload.sms?.otp;
  if (!phone || !code) {
    Sentry.captureException(
      new Error("Send SMS hook payload missing user.phone or sms.otp"),
    );
    return new Response(null, { status: 400 });
  }

  try {
    const sender = getOtpSender();
    await sender.send(toE164(phone), code);
    return new Response(null, { status: 200 });
  } catch (err) {
    // OtpProviderError messages carry Meta's error code and message, never
    // the OTP — Meta does not echo it back and we never interpolate it.
    // Log as well as report: Sentry no-ops without a DSN, and a silent
    // delivery failure is the worst possible failure mode here.
    console.error("[send-otp] delivery failed:", (err as Error)?.message);
    Sentry.captureException(err);
    const permanent = err instanceof OtpProviderError && err.permanent;
    // 400 tells Supabase not to bother retrying a config error three times;
    // 500 lets its 3x/2s backoff do useful work on a transient failure.
    return new Response(null, { status: permanent ? 400 : 500 });
  }
}
