// POST /api/login/verify
// Validates the OTP via Supabase Auth and lets SSR cookies persist the session.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  phone: z.string().min(1),
  otp_code: z.string().regex(/^\d{4,8}$/),
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
      return jsonError(400, {
        error: "invalid_phone",
        code: "invalid_phone",
        fields: { phone: "صيغة رقم الهاتف غير صحيحة" },
      });
    }
    throw e;
  }

  const rl = await rateLimit("loginVerify", `phone:${phoneE164}`);
  const rlIp = await rateLimit("loginVerify", `ip:${ip}`);
  if (!rl.success || !rlIp.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  // Dev-only short-circuit. Accept any 6-digit code if it matches the dev
  // doctor's phone. The dev shim handles "session" via env vars; no real
  // auth.users row is created. Hard-blocked in production.
  if (
    process.env.USE_DEV_USER === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    const service = createSupabaseServiceClient();
    const dev = await service
      .from("doctors")
      .select("id, is_active, is_admin_approved")
      .eq("phone_e164", phoneE164)
      .maybeSingle();
    if (!dev.data) {
      return jsonError(404, { error: "not_found", code: "not_found" });
    }
    return jsonOk({
      ok: true,
      is_admin_approved: dev.data.is_admin_approved,
      dev_bypass: true,
    });
  }

  const ssr = await createSupabaseServerClient();
  const verify = await ssr.auth.verifyOtp({
    phone: phoneE164,
    token: parsed.otp_code,
    type: "sms",
  });
  if (verify.error || !verify.data.user) {
    return jsonError(400, { error: "invalid_otp", code: "invalid_otp" });
  }

  const service = createSupabaseServiceClient();
  const doctor = await service
    .from("doctors")
    .select("id, is_active, is_admin_approved")
    .eq("auth_user_id", verify.data.user.id)
    .maybeSingle();

  return jsonOk({
    ok: true,
    is_admin_approved: doctor.data?.is_admin_approved ?? false,
  });
}
