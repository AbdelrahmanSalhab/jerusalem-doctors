// POST /api/signup/resend
// Re-sends the signup OTP for an in-flight pending_signups row. Previously the
// UI told the user to re-enter the whole 12-field registration form, which is
// a brutal recovery path for a message that simply didn't arrive.
//
// No Turnstile: /signup/start already gated this session, its token is
// single-use, and the /verify page has no widget to mint a fresh one. The gate
// here is possession of an unexpired signup_session_id plus a tight rate limit.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  signup_session_id: z.uuid(),
});

export async function POST(req: Request) {
  const ip = ipFromHeaders(req);

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const rl = await rateLimit("signupResend", `session:${parsed.signup_session_id}`);
  const rlIp = await rateLimit("signupResend", `ip:${ip}`);
  if (!rl.success || !rlIp.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  const service = createSupabaseServiceClient();
  const pending = await service
    .from("pending_signups")
    .select("id, phone_e164, expires_at")
    .eq("id", parsed.signup_session_id)
    .maybeSingle();
  if (pending.error && pending.error.code !== "PGRST116") throw pending.error;

  if (!pending.data || new Date(pending.data.expires_at).getTime() < Date.now()) {
    return jsonError(410, {
      error: "session_expired",
      code: "session_expired",
    });
  }

  if (
    process.env.USE_DEV_USER === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    return jsonOk({ ok: true, dev_bypass: true });
  }

  const ssr = await createSupabaseServerClient();
  const { error: otpErr } = await ssr.auth.signInWithOtp({
    phone: pending.data.phone_e164,
  });
  if (otpErr) {
    console.error("[signup/resend] signInWithOtp failed", otpErr);
    return jsonError(502, { error: "otp_send_failed", code: "otp_send_failed" });
  }

  return jsonOk({ ok: true });
}
