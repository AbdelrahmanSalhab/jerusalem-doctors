// POST /api/signup/verify
// Validates the OTP via Supabase Auth, then materialises the doctor row from
// the pending_signups payload, links specialties, and lets the SSR cookie
// helper persist the session.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const MAX_ATTEMPTS = 5;

const Body = z.object({
  signup_session_id: z.uuid(),
  otp_code: z.string().regex(/^\d{4,8}$/),
});

interface PendingPayload {
  phone_e164: string;
  phone_display: string;
  license_number: string;
  arabic_first_name: string;
  arabic_family_name: string;
  arabic_first_name_normalized: string;
  arabic_family_name_normalized: string;
  arabic_full_name_normalized: string;
  hebrew_first_name: string;
  hebrew_family_name: string;
  subspecialty: string | null;
  subspecialty_normalized: string | null;
  email: string | null;
  specialty_ids: string[];
  license_verification_status:
    | "verified"
    | "soft_match"
    | "not_found"
    | "name_mismatch_overridden"
    | null;
}

export async function POST(req: Request) {
  const ip = ipFromHeaders(req);

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const rl = await rateLimit(
    "signupVerify",
    `session:${parsed.signup_session_id}`,
  );
  const rlIp = await rateLimit("signupVerify", `ip:${ip}`);
  if (!rl.success || !rlIp.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  const service = createSupabaseServiceClient();
  const ssr = await createSupabaseServerClient();

  const pending = await service
    .from("pending_signups")
    .select("id, phone_e164, payload, expires_at, attempts")
    .eq("id", parsed.signup_session_id)
    .maybeSingle();
  if (pending.error && pending.error.code !== "PGRST116") throw pending.error;
  if (!pending.data) {
    return jsonError(410, { error: "session_expired", code: "session_expired" });
  }

  if (new Date(pending.data.expires_at).getTime() < Date.now()) {
    await service.from("pending_signups").delete().eq("id", pending.data.id);
    return jsonError(410, { error: "session_expired", code: "session_expired" });
  }

  if (pending.data.attempts >= MAX_ATTEMPTS) {
    await service.from("pending_signups").delete().eq("id", pending.data.id);
    return jsonError(429, {
      error: "too_many_attempts",
      code: "too_many_attempts",
    });
  }

  // Increment attempts BEFORE calling Supabase verifyOtp so a flood of bad
  // codes can't bypass the counter via abandoned races.
  await service
    .from("pending_signups")
    .update({ attempts: pending.data.attempts + 1 })
    .eq("id", pending.data.id);

  const verify = await ssr.auth.verifyOtp({
    phone: pending.data.phone_e164,
    token: parsed.otp_code,
    type: "sms",
  });
  if (verify.error || !verify.data.user) {
    return jsonError(400, { error: "invalid_otp", code: "invalid_otp" });
  }

  const userId = verify.data.user.id;
  const payload = pending.data.payload as PendingPayload;

  const isAutoApproved = payload.license_verification_status === "verified";

  const insert = await service
    .from("doctors")
    .insert({
      auth_user_id: userId,
      phone_e164: payload.phone_e164,
      phone_display: payload.phone_display,
      license_number: payload.license_number,
      license_verified_at:
        payload.license_verification_status === "verified" ||
        payload.license_verification_status === "soft_match"
          ? new Date().toISOString()
          : null,
      license_verification_status: payload.license_verification_status,

      arabic_first_name: payload.arabic_first_name,
      arabic_family_name: payload.arabic_family_name,
      arabic_first_name_normalized: payload.arabic_first_name_normalized,
      arabic_family_name_normalized: payload.arabic_family_name_normalized,
      arabic_full_name_normalized: payload.arabic_full_name_normalized,

      hebrew_first_name: payload.hebrew_first_name,
      hebrew_family_name: payload.hebrew_family_name,

      subspecialty: payload.subspecialty,
      subspecialty_normalized: payload.subspecialty_normalized,
      email: payload.email,

      consent_directory_use: true,
      consent_timestamp: new Date().toISOString(),

      is_phone_verified: true,
      is_admin_approved: isAutoApproved,
      is_visible: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (insert.error) {
    console.error("[signup/verify] doctor insert failed", insert.error);
    return jsonError(500, { error: "create_failed", code: "create_failed" });
  }

  if (payload.specialty_ids.length > 0) {
    const links = await service.from("doctor_specialties").insert(
      payload.specialty_ids.map((sid) => ({
        doctor_id: insert.data.id,
        specialty_id: sid,
      })),
    );
    if (links.error) {
      console.error("[signup/verify] specialty link failed", links.error);
      // Continue — admin can fix specialty links later.
    }
  }

  await service.from("pending_signups").delete().eq("id", pending.data.id);

  await service.from("audit_logs").insert({
    actor_doctor_id: insert.data.id,
    action: "signup_verified",
    target_doctor_id: insert.data.id,
    metadata: {
      license_status: payload.license_verification_status,
      auto_approved: isAutoApproved,
    },
  });

  return jsonOk({ ok: true, auto_approved: isAutoApproved });
}
