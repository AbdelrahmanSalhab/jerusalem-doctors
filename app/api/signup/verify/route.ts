// POST /api/signup/verify
// Validates the OTP via Supabase Auth, then materialises the doctor row from
// the pending_signups payload, links specialties, and lets the SSR cookie
// helper persist the session.

import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { linkAuthUser } from "@/lib/auth/link";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { relinkDoctor } from "@/lib/institutions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { WorkplaceType } from "@/lib/workplace";
import { writeAudit } from "@/lib/audit";

const MAX_ATTEMPTS = 5;

const Body = z.object({
  signup_session_id: z.uuid(),
  otp_code: z.string().regex(/^\d{4,8}$/),
});

interface PendingWorkplace {
  name: string;
  name_normalized: string;
  workplace_type: WorkplaceType;
  details: string | null;
  /** Absent on rows written before 0012 (pending rows live 15 minutes). */
  address?: string | null;
  hours?: string | null;
  phone?: string | null;
  is_primary: boolean;
  sort_order: number;
}

/** signup/start's pending row for a phone that already has an account. */
interface ExistingAccountPayload {
  phone_e164: string;
  existing_doctor_id: string;
}

interface PendingPayload {
  phone_e164: string;
  phone_display: string;
  license_number: string;
  license_region: "IL" | "PS";
  secondary_license_region: "IL" | "PS" | null;
  secondary_license_number: string | null;
  secondary_license_verification_status:
    | "verified"
    | "soft_match"
    | "not_found"
    | "name_mismatch_overridden"
    | null;
  arabic_first_name: string;
  arabic_family_name: string;
  arabic_first_name_normalized: string;
  arabic_family_name_normalized: string;
  arabic_full_name_normalized: string;
  hebrew_first_name: string | null;
  hebrew_family_name: string | null;
  subspecialty: string | null;
  subspecialty_normalized: string | null;
  email: string | null;
  bio: string | null;
  career_stage: "resident" | "specialist" | null;
  residency_start_year: number | null;
  /** Absent on rows written before 0013. */
  certificates?: string[];
  certificates_normalized?: string | null;
  seeking_work?: boolean;
  retired?: boolean;
  specialty_ids: string[];
  workplaces: PendingWorkplace[];
  license_verification_status:
    | "verified"
    | "soft_match"
    | "not_found"
    | "name_mismatch_overridden"
    | null;
}

export const POST = withJsonErrors(async (req: Request) => {
  const ip = ipFromHeaders(req);

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  // Both windows are checked (and counted) on every request; in parallel
  // they cost one Redis round trip instead of two.
  const [rl, rlIp] = await Promise.all([
    rateLimit("signupVerify", `session:${parsed.signup_session_id}`),
    rateLimit("signupVerifyIp", `ip:${ip}`),
  ]);
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

  // Take this attempt BEFORE calling Supabase verifyOtp, and only if the
  // count is still the one we read: parallel requests that all read the same
  // count would otherwise each get a guess past MAX_ATTEMPTS. The one that
  // loses the race is turned away without spending a guess.
  const claimed = await service
    .from("pending_signups")
    .update({ attempts: pending.data.attempts + 1 })
    .eq("id", pending.data.id)
    .eq("attempts", pending.data.attempts)
    .select("id");
  if (claimed.error) throw claimed.error;
  if (!claimed.data || claimed.data.length === 0) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
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
  if ("existing_doctor_id" in pending.data.payload) {
    const res = await signInExisting(
      service,
      pending.data.id,
      pending.data.payload as ExistingAccountPayload,
      userId,
    );
    // verifyOtp already set the session cookies. A refused sign-in (inactive
    // or vanished account) must not leave that session behind.
    if (!res.ok) await ssr.auth.signOut();
    return res;
  }
  const payload = pending.data.payload as PendingPayload;

  const isAutoApproved = payload.license_verification_status === "verified";

  const insert = await service
    .from("doctors")
    .insert({
      auth_user_id: userId,
      phone_e164: payload.phone_e164,
      phone_display: payload.phone_display,
      license_number: payload.license_number,
      license_region: payload.license_region,
      secondary_license_region: payload.secondary_license_region,
      secondary_license_number: payload.secondary_license_number,
      secondary_license_verification_status:
        payload.secondary_license_verification_status,
      career_stage: payload.career_stage,
      // `?? null` rather than a bare read: a pending row written by the
      // previous deploy has no such key, and supabase-js would silently drop
      // an undefined from the insert.
      residency_start_year: payload.residency_start_year ?? null,
      certificates: payload.certificates ?? [],
      certificates_normalized: payload.certificates_normalized ?? null,
      seeking_work: payload.seeking_work ?? false,
      retired: payload.retired ?? false,
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
      bio: payload.bio,

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
    // 23505 = unique_violation. This is the legitimate outcome of a genuine
    // race, two signups for the same phone/license slipping past the
    // pre-checks in signup/start at the same moment, not a server bug, so
    // it gets its own code rather than a generic 500.
    if (insert.error.code === "23505") {
      console.warn("[signup/verify] doctor insert race (duplicate)", insert.error);
      return jsonError(409, { error: "duplicate", code: "duplicate" });
    }
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
      // Continue, admin can fix specialty links later.
    }
  }

  if (payload.workplaces?.length) {
    const wp = await service.from("doctor_workplaces").insert(
      payload.workplaces.map((w) => ({
        doctor_id: insert.data.id,
        name: w.name,
        name_normalized: w.name_normalized,
        workplace_type: w.workplace_type,
        details: w.details,
        address: w.address ?? null,
        hours: w.hours ?? null,
        phone: w.phone ?? null,
        is_primary: w.is_primary,
        sort_order: w.sort_order,
      })),
    );
    if (wp.error) {
      console.error("[signup/verify] workplace insert failed", wp.error);
      // Non-fatal: doctor can add workplaces later from /profile.
    } else {
      await relinkDoctor(service, insert.data.id);
    }
  }

  await service.from("pending_signups").delete().eq("id", pending.data.id);

  await writeAudit(service, {
    actor_doctor_id: insert.data.id,
    action: "signup_verified",
    target_doctor_id: insert.data.id,
    metadata: {
      license_status: payload.license_verification_status,
      auto_approved: isAutoApproved,
    },
  });

  if (!isAutoApproved) {
    // Reaches whoever has a Sentry alert rule on it; the admin nav also
    // shows the pending count.
    Sentry.captureMessage("New doctor waiting for approval", {
      level: "info",
      tags: { license_status: String(payload.license_verification_status) },
    });
  }

  return jsonOk({ ok: true, auto_approved: isAutoApproved });
});

/** The OTP proved the phone, so the owner is signed in to the account they
 *  already have: past this point, saying it exists reveals nothing. */
async function signInExisting(
  service: ReturnType<typeof createSupabaseServiceClient>,
  pendingId: string,
  payload: ExistingAccountPayload,
  userId: string,
) {
  await service.from("pending_signups").delete().eq("id", pendingId);

  const doctor = await service
    .from("doctors")
    .select("id, is_active, is_admin_approved, auth_user_id")
    .eq("id", payload.existing_doctor_id)
    .maybeSingle();
  if (doctor.error && doctor.error.code !== "PGRST116") throw doctor.error;
  if (!doctor.data) {
    return jsonError(410, { error: "session_expired", code: "session_expired" });
  }
  if (!doctor.data.is_active) {
    return jsonError(403, { error: "account_inactive", code: "account_inactive" });
  }
  if (!(await linkAuthUser(service, doctor.data, userId))) {
    return jsonError(500, { error: "link_failed", code: "link_failed" });
  }
  return jsonOk({
    ok: true,
    auto_approved: doctor.data.is_admin_approved,
    existing_account: true,
  });
}
