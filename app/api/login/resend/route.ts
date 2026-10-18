// POST /api/login/resend
// Re-sends the login OTP from the /verify page. Turnstile-gated like
// /api/login/start: every send spends from Supabase's project-wide SMS
// budget, and an ungated resend let anyone who knows doctors' phones drain
// it and lock everyone out of login and signup.
//
// It must not become a phone enumeration oracle: it returns 200 whether or
// not the number is registered, and only actually sends when an active doctor
// exists. Further bounded by per-phone and per-IP limits.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { rejectUndeliverablePhone } from "@/lib/otp/phone_gate";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";

const Body = z.object({
  phone: z.string().min(1),
  turnstile_token: z.string().optional(),
});

export async function POST(req: Request) {
  const ip = ipFromHeaders(req);

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const ts = await verifyTurnstile(parsed.turnstile_token, ip);
  if (!ts.ok) {
    return jsonError(403, { error: "turnstile_failed", code: "turnstile_failed" });
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

  // Both windows are checked (and counted) on every request; in parallel
  // they cost one Redis round trip instead of two.
  const [rl, rlIp] = await Promise.all([
    rateLimit("loginResend", `phone:${phoneE164}`),
    rateLimit("loginResendIp", `ip:${ip}`),
  ]);
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
