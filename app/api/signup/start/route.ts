// POST /api/signup/start
// Validates the full signup form, re-checks uniqueness + license, persists a
// `pending_signups` row keyed by phone, and triggers Supabase Auth's OTP
// flow. Returns the signup session id which the client must echo back to
// /verify. Delivery happens out of band: Supabase generates the code and
// POSTs its Send SMS Hook to /api/auth/hooks/send-otp, which sends it over
// SMS via the SMS4FREE API.

import { CertificatesSchema, certificatesNormalized } from "@/lib/certificates";
import { z } from "zod";
import { isResidentAndRetired, RESIDENT_NOT_RETIRED } from "@/lib/careerStage";
import { purgeUnfinished, RESUME_FORM_MAX_BYTES } from "@/lib/signup/unfinished";
import { withHmoIds } from "@/lib/institutions";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors, zodFields } from "@/lib/api/respond";
import { CAREER_STAGES, RESIDENCY_YEAR_MIN } from "@/lib/careerStage";
import {
  type LicenseVerifyResult,
  type ResolvedIlLicense,
  resolveIlLicense,
} from "@/lib/moh/match";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import {
  canonicalLicenseNumber,
  ilLicenseCandidates,
  type LicenseRegion,
  licenseFormatErrorMessage,
} from "@/lib/normalize/license";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { failureReason, recordSendFailure } from "@/lib/otp/failure";
import { rejectUndeliverablePhone, rejectWhilePhoneAuthDisabled } from "@/lib/otp/phone_gate";
import { rateLimit } from "@/lib/ratelimit";
import { recordEvent } from "@/lib/usage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/db/database.types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";
import { type WorkplaceType, WorkplaceInputSchema } from "@/lib/workplace";

const PENDING_TTL_MS = 15 * 60_000;

const Body = z
  .object({
    phone: z.string().min(1),
    license_region: z.enum(["IL", "PS"]),
    license_number: z.string().min(1),
    // A doctor can be dually licensed (e.g. IL-licensed but also PS
    // certified, or vice versa). Both fields are set together or not at all
    //, enforced below.
    secondary_license_region: z.enum(["IL", "PS"]).optional().nullable(),
    secondary_license_number: z.string().trim().max(20).optional().nullable(),
    arabic_first_name: z.string().trim().min(2).max(80),
    arabic_family_name: z.string().trim().min(2).max(80),
    // Only meaningful when either license is IL, used solely to cross-check
    // the Israeli MoH registry. PS doctors have no registry to match against.
    hebrew_first_name: z.string().trim().max(80).optional().nullable(),
    hebrew_family_name: z.string().trim().max(80).optional().nullable(),
    specialty_ids: z.array(z.uuid()).min(1).max(5),
    // Self-declared (see lib/careerStage.ts). null == طب عام. Deliberately
    // no cross-field rules, which stage may pair with which workplace type
    // or specialty is a form-level guide, not a data constraint.
    career_stage: z.enum(CAREER_STAGES).nullable().optional(),
    residency_start_year: z
      .number()
      .int()
      .min(RESIDENCY_YEAR_MIN)
      .max(2100)
      .nullable()
      .optional(),
    subspecialty: z.string().trim().max(120).optional().nullable(),
    email: z.email().max(254),
    bio: z.string().trim().max(500).optional().nullable(),
    // Exactly one entry must be is_primary:true when any are given:
    // validated below. Residents may give none (they rotate).
    workplaces: z.array(WorkplaceInputSchema).max(20),
    certificates: CertificatesSchema.optional(),
    seeking_work: z.boolean().optional(),
    retired: z.boolean().optional(),
    consent: z.literal(true),
    pledge: z.literal(true),
    turnstile_token: z.string().optional(),
    // Soft-match override flow: client confirms registry name; we record it.
    override_name_mismatch: z.boolean().optional(),
    // The form as typed, kept so a reminder can reopen it filled in
    // (lib/signup/unfinished.ts). Never read for the account itself.
    resume_form: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (b) => Boolean(b.secondary_license_region) === Boolean(b.secondary_license_number),
    { message: "أدخل رقم الترخيص الإضافي وجهته معًا", path: ["secondary_license_number"] },
  )
  .refine((b) => b.secondary_license_region !== b.license_region, {
    message: "الترخيص الإضافي يجب أن يكون من الجهة الأخرى",
    path: ["secondary_license_region"],
  })
  .refine((b) => !isResidentAndRetired(b.career_stage, b.retired), {
    message: RESIDENT_NOT_RETIRED.error,
    path: ["retired"],
  })
  // Residents rotate; a doctor looking for work or retired may have none.
  .refine(
    (b) =>
      b.career_stage === "resident" ||
      b.seeking_work ||
      b.retired ||
      b.workplaces.length > 0,
    {
      message: "أدخل مكان عمل واحدًا على الأقل",
      path: ["workplaces"],
    },
  );

export const POST = withJsonErrors(async (req: Request) => {
  const disabled = rejectWhilePhoneAuthDisabled();
  if (disabled) return disabled;

  const ip = ipFromHeaders(req);

  // Per-IP gate first; per-phone limit after we normalize.
  const rlIp = await rateLimit("signupStartIp", `ip:${ip}`);
  if (!rlIp.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return jsonError(400, {
      error: "invalid_body",
      code: "invalid_body",
      fields: e instanceof z.ZodError ? zodFields(e) : undefined,
    });
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

  const rlPhone = await rateLimit("signupStart", `phone:${phoneE164}`);
  if (!rlPhone.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  const region = parsed.license_region;
  const secondaryRegion = parsed.secondary_license_region ?? null;
  const rawSecondaryLicense = parsed.secondary_license_number?.trim() || null;
  const hasSecondary = Boolean(secondaryRegion && rawSecondaryLicense);

  // Read both numbers before anything else touches them. An IL license
  // reduces to the registry serial, so the profession prefix the MoH site
  // displays (`1-189371`, or `1189371` once the hyphen is dropped) can't
  // reach the uniqueness check, the registry lookup, or the stored row under
  // three different spellings. An unseparated `123456` has a second reading
  // (`1-23456`); which one is stored is settled by the registry below.
  const primaryReading = readLicense(region, parsed.license_number);
  if (primaryReading === null) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: {
        license_number: licenseFormatErrorMessage(region, parsed.license_number),
      },
    });
  }
  const secondaryReading = hasSecondary
    ? readLicense(secondaryRegion!, rawSecondaryLicense!)
    : null;
  if (hasSecondary && secondaryReading === null) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: {
        secondary_license_number: licenseFormatErrorMessage(
          secondaryRegion!,
          rawSecondaryLicense!,
        ),
      },
    });
  }

  // Hebrew name is only meaningful for cross-checking the Israeli MoH
  // registry, required whenever either license slot is IL.
  const needsHebrewName = region === "IL" || secondaryRegion === "IL";
  if (needsHebrewName) {
    if (
      !parsed.hebrew_first_name ||
      parsed.hebrew_first_name.trim().length < 2 ||
      !parsed.hebrew_family_name ||
      parsed.hebrew_family_name.trim().length < 2
    ) {
      return jsonError(400, {
        error: "invalid_body",
        code: "invalid_body",
        fields: {
          hebrew_full_name:
            "الاسم بالعبرية مطلوب لمطابقة سجل وزارة الصحة الإسرائيلية",
        },
      });
    }
  }

  const service = createSupabaseServiceClient();
  const names = {
    hebrewFirstName: parsed.hebrew_first_name ?? "",
    hebrewFamilyName: parsed.hebrew_family_name ?? "",
  };

  // MoH cross-check only applies to the Israeli registry. PS-track signups
  // have nothing to check against, so they always fall through to manual
  // admin review, same outcome as an IL license we can't find. It runs
  // before the uniqueness check because it decides which serial is stored.
  const primary = await resolveReading(service, primaryReading, names);
  const verified = primary.result;
  if (verified.status === "name_mismatch" && !parsed.override_name_mismatch) {
    return jsonError(409, {
      error: "license_name_mismatch",
      code: "license_name_mismatch",
      fields: {
        hebrew_full_name: "الاسم العبري لا يطابق سجل وزارة الصحة",
      },
    });
  }
  const license = primary.serial;

  // The secondary license is supplementary, we opportunistically cross-check
  // it against the IL registry when applicable, but it never blocks signup
  // or requires the override flow (only the primary license gates access).
  const secondary = secondaryReading
    ? await resolveReading(service, secondaryReading, names)
    : null;
  const secondaryLicense = secondary?.serial ?? null;
  const secondaryVerified = secondary?.result ?? null;

  // A phone that already has an account goes through every check a new
  // signup does and gets the same response, so this form can't be used to
  // test whether a number is registered. Its OTP logs the owner in instead
  // (see existing_doctor_id in signup/verify). The branch is taken only after
  // the last check that could reject a new signup: answering early would
  // make "registered" observable through any body a new signup would fail.
  const phoneOwner = await service
    .from("doctors")
    .select("id")
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  if (phoneOwner.error && phoneOwner.error.code !== "PGRST116") throw phoneOwner.error;
  const ownerId: string | null = phoneOwner.data?.id ?? null;

  // Licence uniqueness. License numbers are only unique within their own
  // issuing region, and a license number can't be reused across doctors
  // regardless of which slot (primary/secondary) it's registered in. Licenses are public in the MoH
  // registry, so naming this duplicate gives nothing away.
  const licensePairs = [{ region, license }];
  if (hasSecondary) licensePairs.push({ region: secondaryRegion!, license: secondaryLicense! });
  const licenseOr = licensePairs
    .flatMap((p) => [
      `and(license_region.eq.${p.region},license_number.eq.${p.license})`,
      `and(secondary_license_region.eq.${p.region},secondary_license_number.eq.${p.license})`,
    ])
    .join(",");
  const dupe = await service
    .from("doctors")
    .select("id")
    .or(licenseOr)
    .limit(1)
    .maybeSingle();
  if (dupe.error && dupe.error.code !== "PGRST116") throw dupe.error;
  // No exception for the phone's owner re-entering their own license: letting
  // that through would answer 200 where any other phone gets 409, which
  // confirms the phone is registered (and whose it is, licenses being
  // public). The owner signs in from /login instead.
  if (dupe.data) {
    return jsonError(409, {
      error: "duplicate",
      code: "duplicate",
      fields: {
        license_number:
          "رقم الترخيص مُسجّل مسبقًا. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.",
      },
    });
  }

  // Career stage is NOT derived from the registry. It used to be: a row
  // without `שם התמחות` was read as "resident". But a blank specialty means
  // "holds no board certificate", which is just as true of a general
  // practitioner who never pursued one, so long-practising GPs were badged
  // طبيب مقيم. The registry publishes nothing that tells the two apart, so
  // the doctor declares it on the form and we store what they say.
  // `registrySpecialtyHe` is still surfaced by /api/signup/check-license as
  // an informational signal.

  // Pre-compute normalized columns for the doctors row we'll insert on /verify.
  const arabicFirstNorm = normalizeArabic(parsed.arabic_first_name);
  const arabicFamilyNorm = normalizeArabic(parsed.arabic_family_name);
  const arabicFullNorm = normalizeArabic(
    `${parsed.arabic_first_name} ${parsed.arabic_family_name}`,
  );
  const hebrewFirstStored = parsed.hebrew_first_name
    ? normalizeHebrew(parsed.hebrew_first_name)
    : null;
  const hebrewFamilyStored = parsed.hebrew_family_name
    ? normalizeHebrew(parsed.hebrew_family_name)
    : null;
  const subspecialtyNorm = parsed.subspecialty
    ? normalizeArabic(parsed.subspecialty)
    : null;

  // Exactly one workplace must be primary (when there are any).
  const primaryCount = parsed.workplaces.filter((w) => w.is_primary).length;
  if (parsed.workplaces.length > 0 && primaryCount !== 1) {
    return jsonError(400, {
      error: "invalid_body",
      code: "invalid_body",
      fields: { workplaces: "يجب أن يكون هناك مكان عمل رئيسي واحد" },
    });
  }

  if (ownerId) {
    return startPendingSignup(
      service,
      phoneE164,
      { phone_e164: phoneE164, existing_doctor_id: ownerId },
      verified.status,
    );
  }

  // Dedupe by normalized name, keep the primary first.
  const seenWp = new Set<string>();
  const workplaces: {
    name: string;
    name_normalized: string;
    workplace_type: WorkplaceType;
    details: string | null;
    address: string | null;
    hours: string | null;
    phone: string | null;
    hmo: string | null;
    is_primary: boolean;
    sort_order: number;
  }[] = [];
  const ordered = [...parsed.workplaces].sort((a, b) =>
    a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1,
  );
  ordered.forEach((w, i) => {
    const norm = normalizeArabic(w.name);
    if (seenWp.has(norm)) return;
    seenWp.add(norm);
    workplaces.push({
      name: w.name,
      name_normalized: norm,
      workplace_type: w.workplace_type,
      details: w.details,
      address: w.address,
      hours: w.hours,
      phone: w.phone,
      // A fund only belongs to a clinic.
      hmo: w.workplace_type === "clinic" ? (w.hmo ?? null) : null,
      is_primary: w.is_primary,
      sort_order: i,
    });
  });

  return startPendingSignup(
    service,
    phoneE164,
    {
      phone_e164: phoneE164,
      phone_display: parsed.phone.trim(),
      license_number: license,
      license_region: region,
      secondary_license_region: hasSecondary ? secondaryRegion : null,
      secondary_license_number: hasSecondary ? secondaryLicense : null,

      arabic_first_name: parsed.arabic_first_name.trim(),
      arabic_family_name: parsed.arabic_family_name.trim(),
      arabic_first_name_normalized: arabicFirstNorm,
      arabic_family_name_normalized: arabicFamilyNorm,
      arabic_full_name_normalized: arabicFullNorm,

      hebrew_first_name: hebrewFirstStored,
      hebrew_family_name: hebrewFamilyStored,

      subspecialty: parsed.subspecialty?.trim() || null,
      subspecialty_normalized: subspecialtyNorm,
      email: parsed.email?.trim() || null,
      bio: parsed.bio?.trim() || null,
      career_stage: parsed.career_stage ?? null,
      residency_start_year: parsed.residency_start_year ?? null,
      ...certificateFields(parsed.certificates ?? []),
      seeking_work: parsed.seeking_work ?? false,
      retired: parsed.retired ?? false,

      specialty_ids: parsed.specialty_ids,
      // A clinic's fund as the fund's id (signup/verify inserts these rows).
      workplaces: await withHmoIds(service, workplaces),

      license_verification_status: licenseStatusToColumn(
        verified.status,
        parsed.override_name_mismatch,
      ),
      // Dropped rather than refused when too big: it is only a convenience.
      ...(parsed.resume_form && JSON.stringify(parsed.resume_form).length <= RESUME_FORM_MAX_BYTES
        ? { resume_form: parsed.resume_form }
        : {}),
      secondary_license_verification_status: secondaryVerified
        ? licenseStatusToColumn(secondaryVerified.status, false)
        : null,
    },
    verified.status,
  );
});

/** Stores the pending row and sends the OTP: the one response every accepted
 *  signup gets, new or already registered. */
async function startPendingSignup(
  service: ReturnType<typeof createSupabaseServiceClient>,
  phoneE164: string,
  payload: Record<string, unknown>,
  licenseStatus: string,
) {
  const now = Date.now();
  const expiresAt = new Date(now + PENDING_TTL_MS).toISOString();

  // Unfinished signups are kept KEEP_DAYS for an admin's reminder, then go:
  // here and in the daily cron. A failed purge never blocks this signup.
  await purgeUnfinished(service, now).catch((err) => {
    console.error("[signup/start] unfinished signups purge failed", err);
  });

  const insert = await service
    .from("pending_signups")
    .insert({ phone_e164: phoneE164, payload: payload as NonNullable<Json>, expires_at: expiresAt })
    .select("id")
    .single();
  if (insert.error) throw insert.error;

  const ssr = await createSupabaseServerClient();
  // channel "sms" is what routes through the Send SMS Hook, which is where
  // our SMS4FREE delivery lives. Supabase's channel:"whatsapp" is a
  // Twilio-only path and would bypass the hook entirely.
  const { error: otpErr } = await ssr.auth.signInWithOtp({
    phone: phoneE164,
    options: { channel: "sms" },
  });
  if (otpErr) {
    // Roll back the pending row so we don't leak an unusable session id.
    await service.from("pending_signups").delete().eq("id", insert.data.id);
    console.error("[signup/start] signInWithOtp failed", otpErr);
    // The row above is gone, so this one is counted without a signup.
    await recordSendFailure(service, failureReason(otpErr));
    return jsonError(502, {
      error: "otp_send_failed",
      code: "otp_send_failed",
    });
  }

  await recordEvent(service, "signup_started");

  return jsonOk({
    signup_session_id: insert.data.id,
    expires_at: expiresAt,
    license_status: licenseStatus,
  });
}

/** A typed license, read but not yet matched: IL may have two readings. */
type LicenseReading =
  | { region: "IL"; candidates: string[] }
  | { region: "PS"; license: string };

function readLicense(region: LicenseRegion, raw: string): LicenseReading | null {
  if (region === "IL") {
    const candidates = ilLicenseCandidates(raw);
    return candidates && { region, candidates };
  }
  const license = canonicalLicenseNumber("PS", raw);
  return license === null ? null : { region, license };
}

/** IL goes to the registry; PS has none, so it lands in admin review. */
async function resolveReading(
  service: ReturnType<typeof createSupabaseServiceClient>,
  reading: LicenseReading,
  names: { hebrewFirstName: string; hebrewFamilyName: string },
): Promise<ResolvedIlLicense> {
  if (reading.region === "PS") {
    const result: LicenseVerifyResult = { status: "not_found", source: "none" };
    return { serial: reading.license, result };
  }
  return resolveIlLicense(service, { candidates: reading.candidates, ...names });
}

function licenseStatusToColumn(
  status: "verified" | "soft_match" | "name_mismatch" | "not_found",
  override?: boolean,
):
  | "verified"
  | "soft_match"
  | "not_found"
  | "name_mismatch_overridden"
  | null {
  switch (status) {
    case "verified":
      return "verified";
    case "soft_match":
      return "soft_match";
    case "not_found":
      return "not_found";
    case "name_mismatch":
      return override ? "name_mismatch_overridden" : null;
  }
}

/** Services and certificates, with their search key. */
function certificateFields(certificates: string[]) {
  return { certificates, certificates_normalized: certificatesNormalized(certificates) };
}
