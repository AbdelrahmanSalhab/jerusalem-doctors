// POST /api/signup/start
// Validates the full signup form, re-checks uniqueness + license, persists a
// `pending_signups` row keyed by phone, and triggers Supabase Auth's OTP
// flow. Returns the signup session id which the client must echo back to
// /verify. Delivery happens out of band: Supabase generates the code and
// POSTs its Send SMS Hook to /api/auth/hooks/send-otp, which sends it over
// SMS via the SMS4FREE API.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { CAREER_STAGES, RESIDENCY_YEAR_MIN } from "@/lib/careerStage";
import { verifyLicense } from "@/lib/moh/match";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import { canonicalLicenseNumber, licenseFormatErrorMessage } from "@/lib/normalize/license";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { rejectUndeliverablePhone } from "@/lib/otp/phone_gate";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";
import { WORKPLACE_TYPES, type WorkplaceType } from "@/lib/workplace";

const PENDING_TTL_MS = 15 * 60_000;

const WorkplaceInput = z.object({
  name: z.string().trim().min(2).max(120),
  workplace_type: z.enum(WORKPLACE_TYPES).default("hospital"),
  details: z.string().trim().max(300).optional().nullable(),
  is_primary: z.boolean(),
});

const Body = z
  .object({
    phone: z.string().min(1),
    license_region: z.enum(["IL", "PS"]),
    license_number: z.string().min(1),
    // A doctor can be dually licensed (e.g. IL-licensed but also PS
    // certified, or vice versa). Both fields are set together or not at all
    // — enforced below.
    secondary_license_region: z.enum(["IL", "PS"]).optional().nullable(),
    secondary_license_number: z.string().trim().max(20).optional().nullable(),
    arabic_first_name: z.string().min(2),
    arabic_family_name: z.string().min(2),
    // Only meaningful when either license is IL — used solely to cross-check
    // the Israeli MoH registry. PS doctors have no registry to match against.
    hebrew_first_name: z.string().trim().max(80).optional().nullable(),
    hebrew_family_name: z.string().trim().max(80).optional().nullable(),
    specialty_ids: z.array(z.uuid()).min(1).max(5),
    // Self-declared (see lib/careerStage.ts). null == طب عام. Deliberately
    // no cross-field rules — which stage may pair with which workplace type
    // or specialty is a form-level guide, not a data constraint.
    career_stage: z.enum(CAREER_STAGES).nullable().optional(),
    residency_start_year: z
      .number()
      .int()
      .min(RESIDENCY_YEAR_MIN)
      .max(2100)
      .nullable()
      .optional(),
    subspecialty: z.string().trim().optional().nullable(),
    email: z.email(),
    bio: z.string().trim().max(500).optional().nullable(),
    // Exactly one entry must be is_primary:true — validated below.
    workplaces: z.array(WorkplaceInput).min(1).max(20),
    consent: z.literal(true),
    turnstile_token: z.string().optional(),
    // Soft-match override flow: client confirms registry name; we record it.
    override_name_mismatch: z.boolean().optional(),
  })
  .refine(
    (b) => Boolean(b.secondary_license_region) === Boolean(b.secondary_license_number),
    { message: "أدخل رقم الترخيص الإضافي وجهته معًا", path: ["secondary_license_number"] },
  )
  .refine((b) => b.secondary_license_region !== b.license_region, {
    message: "الترخيص الإضافي يجب أن يكون من الجهة الأخرى",
    path: ["secondary_license_region"],
  });

export const POST = withJsonErrors(async (req: Request) => {
  const ip = ipFromHeaders(req);

  // Per-IP gate first; per-phone limit after we normalize.
  const rlIp = await rateLimit("signupStart", `ip:${ip}`);
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

  // Canonicalise before anything else touches the number. An IL license
  // reduces to the registry serial, so the profession prefix the MoH site
  // displays (`1-189371`, or `1189371` once the hyphen is dropped) can't
  // reach the uniqueness check, the registry lookup, or the stored row under
  // three different spellings.
  const license = canonicalLicenseNumber(region, parsed.license_number);
  if (license === null) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: {
        license_number: licenseFormatErrorMessage(region, parsed.license_number),
      },
    });
  }
  const secondaryLicense = hasSecondary
    ? canonicalLicenseNumber(secondaryRegion!, rawSecondaryLicense!)
    : null;
  if (hasSecondary && secondaryLicense === null) {
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
  // registry — required whenever either license slot is IL.
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

  // Defensive uniqueness re-check against race with check-unique. License
  // numbers are only unique within their own issuing region, and a license
  // number can't be reused across doctors regardless of which slot
  // (primary/secondary) it's registered in.
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
    .select("id, phone_e164, license_number, secondary_license_number")
    .or(`phone_e164.eq.${phoneE164},${licenseOr}`)
    .limit(1)
    .maybeSingle();
  if (dupe.error && dupe.error.code !== "PGRST116") throw dupe.error;
  if (dupe.data) {
    const field =
      dupe.data.phone_e164 === phoneE164 ? "phone" : "license_number";
    const message =
      field === "phone"
        ? "رقم الهاتف مُسجّل مسبقًا. الرجاء تسجيل الدخول."
        : "رقم الترخيص مُسجّل مسبقًا. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.";
    return jsonError(409, {
      error: "duplicate",
      code: "duplicate",
      fields: { [field]: message },
    });
  }

  // MoH cross-check only applies to the Israeli registry. PS-track signups
  // have nothing to check against, so they always fall through to manual
  // admin review — same outcome as an IL license we can't find.
  const verified =
    region === "IL"
      ? await verifyLicense(service, {
          licenseNumber: Number(license),
          hebrewFirstName: parsed.hebrew_first_name!,
          hebrewFamilyName: parsed.hebrew_family_name!,
        })
      : ({ status: "not_found", source: "none" } as const);
  if (verified.status === "name_mismatch" && !parsed.override_name_mismatch) {
    return jsonError(409, {
      error: "license_name_mismatch",
      code: "license_name_mismatch",
      fields: {
        hebrew_full_name: "الاسم العبري لا يطابق سجل وزارة الصحة",
      },
    });
  }

  // The secondary license is supplementary — we opportunistically cross-check
  // it against the IL registry when applicable, but it never blocks signup
  // or requires the override flow (only the primary license gates access).
  const secondaryVerified =
    hasSecondary && secondaryRegion === "IL"
      ? await verifyLicense(service, {
          licenseNumber: Number(secondaryLicense),
          hebrewFirstName: parsed.hebrew_first_name!,
          hebrewFamilyName: parsed.hebrew_family_name!,
        })
      : hasSecondary
        ? ({ status: "not_found", source: "none" } as const)
        : null;

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

  // Exactly one workplace must be primary.
  const primaryCount = parsed.workplaces.filter((w) => w.is_primary).length;
  if (primaryCount !== 1) {
    return jsonError(400, {
      error: "invalid_body",
      code: "invalid_body",
      fields: { workplaces: "يجب أن يكون هناك مكان عمل رئيسي واحد" },
    });
  }

  // Dedupe by normalized name, keep the primary first.
  const seenWp = new Set<string>();
  const workplaces: {
    name: string;
    name_normalized: string;
    workplace_type: WorkplaceType;
    details: string | null;
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
      details: w.details?.trim() || null,
      is_primary: w.is_primary,
      sort_order: i,
    });
  });

  const now = Date.now();
  const expiresAt = new Date(now + PENDING_TTL_MS).toISOString();

  const insert = await service
    .from("pending_signups")
    .insert({
      phone_e164: phoneE164,
      payload: {
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

        specialty_ids: parsed.specialty_ids,
        workplaces,

        license_verification_status: licenseStatusToColumn(
          verified.status,
          parsed.override_name_mismatch,
        ),
        secondary_license_verification_status: secondaryVerified
          ? licenseStatusToColumn(secondaryVerified.status, false)
          : null,
      },
      expires_at: expiresAt,
    })
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
    return jsonError(502, {
      error: "otp_send_failed",
      code: "otp_send_failed",
    });
  }

  return jsonOk({
    signup_session_id: insert.data.id,
    expires_at: expiresAt,
    license_status: verified.status,
  });
});

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

function zodFields(e: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of e.issues) {
    const key = issue.path.map(String).join(".") || "_";
    fields[key] = issue.message;
  }
  return fields;
}
