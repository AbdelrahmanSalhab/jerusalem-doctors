// POST /api/login/start
// Single-field login by phone. Sends the OTP only to an active, verified
// doctor, but answers the same way for any number: an unregistered phone
// must be indistinguishable from a registered one (OWASP authentication
// guidance; /api/login/resend and /api/signup/start follow the same rule). Delivery is handled by the Send SMS
// Hook at /api/auth/hooks/send-otp (SMS via the SMS4FREE API).
// Resends go to /api/login/resend, which is not Turnstile-gated.

import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { failureReason } from "@/lib/otp/failure";
import { rejectUndeliverablePhone, rejectWhilePhoneAuthDisabled } from "@/lib/otp/phone_gate";
import { rateLimit } from "@/lib/ratelimit";
import { recordEvent } from "@/lib/usage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";

const Body = z.object({
  phone: z.string().min(1),
  turnstile_token: z.string().optional(),
});

export const POST = withJsonErrors(async (req: Request) => {
  const disabled = rejectWhilePhoneAuthDisabled();
  if (disabled) return disabled;

  const ip = ipFromHeaders(req);

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const ts = await verifyTurnstile(parsed.turnstile_token, ip);
  if (!ts.ok) {
    return jsonError(403, {
      error: "turnstile_failed",
      code: "turnstile_failed",
    });
  }

  let phoneE164: string;
  try {
    phoneE164 = normalizePhone(parsed.phone);
  } catch (e) {
    if (e instanceof InvalidPhoneError) {
      return jsonError(400, {
        error: "invalid_phone",
        code: "invalid_phone",
        fields: { phone: "صيغة رقم الهاتف غير صحيحة" },
      });
    }
    throw e;
  }

  const unsupported = rejectUndeliverablePhone(phoneE164);
  if (unsupported) return unsupported;

  // Both windows are checked (and counted) on every request; in parallel
  // they cost one Redis round trip instead of two.
  const [rl, rlIp] = await Promise.all([
    rateLimit("loginStart", `phone:${phoneE164}`),
    rateLimit("loginStartIp", `ip:${ip}`),
  ]);
  if (!rl.success || !rlIp.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  const service = createSupabaseServiceClient();
  const found = await service
    .from("doctors")
    .select("id, is_active, is_phone_verified")
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  if (found.error && found.error.code !== "PGRST116") throw found.error;
  // Both branches answer after the same single lookup; the send and the
  // counting happen after the response (after()), so the reply time does not
  // say whether a number has an account.
  if (!found.data || !found.data.is_active || !found.data.is_phone_verified) {
    // Counted (no number kept): doctors trying to log in before signing up.
    after(() => recordEvent(service, "login_unregistered"));
    return jsonOk({ ok: true, phone_e164: phoneE164 });
  }

  // Dev-only short-circuit: when USE_DEV_USER=1 we skip Supabase Auth and
  // just acknowledge, the dev shim provides the session via cookies/env.
  // Hard-blocked in production by lib/auth/session.ts module-load guard.
  if (
    process.env.USE_DEV_USER === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    return jsonOk({ ok: true, phone_e164: phoneE164, dev_bypass: true });
  }

  const doctorId = found.data.id;
  after(async () => {
    const ssr = await createSupabaseServerClient();
    // channel "sms" is what routes through the Send SMS Hook, which is where
    // our SMS4FREE delivery lives. Supabase's channel:"whatsapp" is a
    // Twilio-only path and would bypass the hook entirely.
    const { error: otpErr } = await ssr.auth.signInWithOtp({
      phone: phoneE164,
      options: { channel: "sms" },
    });
    if (otpErr) {
      // Never surfaced to the caller: an error here, which only a registered
      // phone can reach, would say the number has an account. The doctor sees
      // the "no code?" help on /verify; we see this in Sentry.
      console.error("[login/start] signInWithOtp failed", otpErr);
      Sentry.captureException(otpErr, { tags: { route: "login/start" } });
    }
    await recordEvent(service, otpErr ? "login_send_failed" : "login_code_sent", {
      doctorId,
      ...(otpErr && { meta: { reason: failureReason(otpErr) } }),
    });
  });

  return jsonOk({ ok: true, phone_e164: phoneE164 });
});
