// POST /api/login/resend
// Re-sends the login OTP. Split out from /api/login/start because the /verify
// page has no Turnstile widget, and re-posting to /login/start without a token
// 403s in production (verifyTurnstile treats a missing token as a failure).
//
// This endpoint is unauthenticated and ungated, so it must not become a phone
// enumeration oracle: it returns 200 whether or not the number is registered,
// and only actually sends when an active doctor exists. Abuse is bounded by a
// 3-per-10-minutes limit on both the phone and the IP.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { rejectUndeliverablePhone } from "@/lib/otp/phone_gate";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  phone: z.string().min(1),
});

export async function POST(req: Request) {
  const ip = ipFromHeaders(req);

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  let phoneE164: string;
  try {
    phoneE164 = normalizePhone(parsed.phone);
  } catch (e) {
    if (e instanceof InvalidPhoneError) {
      return jsonError(400, { error: "invalid_phone", code: "invalid_phone" });
    }
    throw e;
  }

  const unsupported = rejectUndeliverablePhone(phoneE164);
  if (unsupported) return unsupported;

  const rl = await rateLimit("loginResend", `phone:${phoneE164}`);
  const rlIp = await rateLimit("loginResend", `ip:${ip}`);
  if (!rl.success || !rlIp.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  if (
    process.env.USE_DEV_USER === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    return jsonOk({ ok: true, dev_bypass: true });
  }

  const service = createSupabaseServiceClient();
  const found = await service
    .from("doctors")
    .select("id, is_active, is_phone_verified")
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  if (found.error && found.error.code !== "PGRST116") throw found.error;

  // Deliberately uniform response — see the enumeration note above.
  if (!found.data || !found.data.is_active || !found.data.is_phone_verified) {
    return jsonOk({ ok: true });
  }

  const ssr = await createSupabaseServerClient();
  const { error: otpErr } = await ssr.auth.signInWithOtp({
    phone: phoneE164,
    options: { shouldCreateUser: false },
  });
  if (otpErr) {
    console.error("[login/resend] signInWithOtp failed", otpErr);
    return jsonError(502, { error: "otp_send_failed", code: "otp_send_failed" });
  }

  return jsonOk({ ok: true });
}
