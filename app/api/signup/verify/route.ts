// POST /api/signup/verify
// Validates the OTP via Supabase Auth, then materialises the doctor row from
// the pending_signups payload, links specialties + workplaces, dispatches a
// verification email, and lets the SSR cookie helper persist the session.
//
// As of issue #16, no signup is auto-approved. Every new doctor row has
// is_admin_approved=false. Visibility in the directory requires:
//   1. admin approval (sets is_admin_approved=true), and
//   2. user_chose_visible=true (default), and
//   3. all the existing gates (is_active, is_phone_verified, consent).
//
// The directory view `doctor_visible` enforces the conjunction at the
// relation level; RLS enforces it at the row level.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { extractDomain, isInstitutionalEmail } from "@/lib/signup/email-allowlist";
import { dispatchSignupVerifyEmail } from "@/lib/signup/email-dispatch";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const MAX_ATTEMPTS = 5;

const Body = z.object({
  signup_session_id: z.uuid(),
  otp_code: z.string().regex(/^\d{4,8}$/),
});

interface PendingWorkplace {
  name: string;
  name_normalized: string;
  is_primary: boolean;
  sort_order: number;
}

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
  email: string;                 // required as of #16
  // email_domain and email_is_institutional were added by Task 9 to new
  // pending sessions. Old sessions created before this migration will not
  // have these fields. Defensive defaults are applied in the insert below.
  email_domain?: string | null;
  email_is_institutional?: boolean;
  specialty_ids: string[];
  workplaces: PendingWorkplace[];
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

  const rl = await rateLimit("signupVerify", `session:${parsed.signup_session_id}`);
  const rlIp = await rateLimit("signupVerify", `ip:${ip}`);
  if (!rl.success || !rlIp.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  const service = createSupabaseServiceClient();
  const ssr = await createSupabaseServerClient();

  // SECURITY INVARIANT: Atomically increment the attempt counter BEFORE reading
  // the pending row payload or calling Supabase verifyOtp. A single UPDATE
  // RETURNING is immune to the read-modify-write race that would let concurrent
  // requests share a stale counter value and collectively exceed MAX_ATTEMPTS.
  const sessionId = parsed.signup_session_id;
  const { data: newAttempts, error: incErr } = await service.rpc(
    "increment_pending_attempts",
    { p_session_id: sessionId },
  );
  if (incErr || newAttempts === null) {
    // RPC failed (row missing or DB error). Treat as session-not-found to
    // avoid leaking existence; 503 signals a transient backend problem.
    return jsonError(503, { error: "service_unavailable", code: "service_unavailable" });
  }
  if (newAttempts > MAX_ATTEMPTS) {
    await service.from("pending_signups").delete().eq("id", sessionId);
    return jsonError(429, { error: "too_many_attempts", code: "too_many_attempts" });
  }

  const pending = await service
    .from("pending_signups")
    .select("id, phone_e164, payload, expires_at, attempts")
    .eq("id", sessionId)
    .maybeSingle();
  if (pending.error && pending.error.code !== "PGRST116") throw pending.error;
  if (!pending.data) {
    return jsonError(410, { error: "session_expired", code: "session_expired" });
  }
  if (new Date(pending.data.expires_at).getTime() < Date.now()) {
    await service.from("pending_signups").delete().eq("id", pending.data.id);
    return jsonError(410, { error: "session_expired", code: "session_expired" });
  }

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
      // Defensive defaults for pending sessions created before the migration
      // (they will not have email_domain / email_is_institutional in their
      // JSON payload). For those sessions, email_domain is derived here and
      // email_is_institutional defaults to false (goes through admin queue).
      email_domain: payload.email_domain ?? (extractDomain(payload.email) ?? null),
      email_is_institutional: payload.email_is_institutional ??
        isInstitutionalEmail(payload.email),

      consent_directory_use: true,
      consent_timestamp: new Date().toISOString(),

      is_phone_verified: true,
      // No auto-approval — every new doctor row awaits admin review (#16).
      is_admin_approved: false,
      // Default visibility preference; visibility in the directory still
      // requires admin approval via the doctor_visible view (#20).
      user_chose_visible: true,
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
    if (links.error) console.error("[signup/verify] specialty link failed", links.error);
  }

  if (payload.workplaces?.length) {
    const wp = await service.from("doctor_workplaces").insert(
      payload.workplaces.map((w) => ({
        doctor_id: insert.data.id,
        name: w.name,
        name_normalized: w.name_normalized,
        is_primary: w.is_primary,
        sort_order: w.sort_order,
      })),
    );
    if (wp.error) console.error("[signup/verify] workplace insert failed", wp.error);
  }

  await service.from("pending_signups").delete().eq("id", pending.data.id);

  await service.from("audit_logs").insert({
    actor_doctor_id: insert.data.id,
    action: "signup_verified",
    target_doctor_id: insert.data.id,
    metadata: {
      license_status: payload.license_verification_status,
      auto_approved: false,
      // Use the same defensive defaults as the insert above for old sessions.
      email_is_institutional: payload.email_is_institutional ?? isInstitutionalEmail(payload.email),
      email_domain: payload.email_domain ?? (extractDomain(payload.email) ?? null),
    },
  });

  // Fire the verification email best-effort. Doctor row exists either way;
  // the admin review surface shows whether the email was confirmed.
  let emailSent = false;
  try {
    await dispatchSignupVerifyEmail({
      doctorId: insert.data.id,
      email: payload.email,
      arabicFirstName: payload.arabic_first_name,
    });
    emailSent = true;
    await service
      .from("doctors")
      .update({ email_verification_sent_at: new Date().toISOString() })
      .eq("id", insert.data.id);
  } catch (err) {
    console.error("[signup/verify] email dispatch failed", err);
  }

  return jsonOk({ ok: true, auto_approved: false, email_verification_sent: emailSent });
}
