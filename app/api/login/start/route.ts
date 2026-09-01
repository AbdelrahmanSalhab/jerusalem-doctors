// POST /api/login/start
// Single-field login by phone. Verifies the doctor exists + is active, then
// kicks off Supabase Auth's OTP flow.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";

const Body = z.object({
  phone: z.string().min(1),
  turnstile_token: z.string().optional(),
});

export const POST = withJsonErrors(async (req: Request) => {
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

  const rl = await rateLimit("loginStart", `phone:${phoneE164}`);
  const rlIp = await rateLimit("loginStart", `ip:${ip}`);
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
  if (!found.data) {
    return jsonError(404, { error: "not_found", code: "not_found" });
  }
  if (!found.data.is_active || !found.data.is_phone_verified) {
    return jsonError(403, { error: "account_inactive", code: "account_inactive" });
  }

  // Dev-only short-circuit: when USE_DEV_USER=1 we skip Supabase Auth and
  // just acknowledge — the dev shim provides the session via cookies/env.
  // Hard-blocked in production by lib/auth/session.ts module-load guard.
  if (
    process.env.USE_DEV_USER === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    return jsonOk({ ok: true, phone_e164: phoneE164, dev_bypass: true });
  }

  const ssr = await createSupabaseServerClient();
  const { error: otpErr } = await ssr.auth.signInWithOtp({
    phone: phoneE164,
    options: { channel: "sms" },
  });
  if (otpErr) {
    console.error("[login/start] signInWithOtp failed", otpErr);
    return jsonError(502, {
      error: "otp_send_failed",
      code: "otp_send_failed",
    });
  }

  return jsonOk({ ok: true, phone_e164: phoneE164 });
});
