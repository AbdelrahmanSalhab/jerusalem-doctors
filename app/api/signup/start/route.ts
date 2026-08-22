// POST /api/signup/start
// Validates the full signup form, re-checks uniqueness + license, persists a
// `pending_signups` row keyed by phone, and triggers Supabase Auth's OTP
// flow (Twilio configured at the Supabase project level). Returns the
// signup session id which the client must echo back to /verify.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { verifyLicense } from "@/lib/moh/match";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import { isValidLicenseFormat, licenseFormatErrorMessage } from "@/lib/normalize/license";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";

const PENDING_TTL_MS = 15 * 60_000;

const WorkplaceInput = z.object({
  name: z.string().trim().min(2).max(120),
  workplace_type: z.enum(["hospital", "clinic"]).default("hospital"),
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

  const rlPhone = await rateLimit("signupStart", `phone:${phoneE164}`);
  if (!rlPhone.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  const license = parsed.license_number.trim();
  const region = parsed.license_region;
  const secondaryRegion = parsed.secondary_license_region ?? null;
  const secondaryLicense = parsed.secondary_license_number?.trim() || null;
  const hasSecondary = Boolean(secondaryRegion && secondaryLicense);

  if (!isValidLicenseFormat(region, license)) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: { license_number: licenseFormatErrorMessage(region) },
    });
  }
  if (hasSecondary && !isValidLicenseFormat(secondaryRegion!, secondaryLicense!)) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: {
        secondary_license_number: licenseFormatErrorMessage(secondaryRegion!),
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

  // Career stage is only auto-derivable from an IL match: the registry row
  // carries `שם התמחות` (specialty certificate name) when the doctor holds a
  // specialization certificate, and omits it when they don't yet — i.e.
  // still a resident / general practitioner. No equivalent signal exists for
  // PS, so a PS-only doctor stays unset (admin can set it manually later). A
  // dual-licensed doctor takes the more specific answer from either match.
  //
  // `allowMismatch` lets the primary license count a `name_mismatch` result:
  // by the time we reach this point a primary mismatch can only mean the
  // doctor clicked through the override-confirm flow above (an unconfirmed
  // mismatch already returned 409 earlier), so the license-number match is
  // just as trustworthy as `verified` — only the name-spelling confidence
  // differs, which the override already resolved. The secondary license has
  // no override flow, so its mismatches never count.
  const stageFrom = (
    result: { status: string; registrySpecialtyHe?: string | null } | null,
    allowMismatch: boolean,
  ): "resident" | "specialist" | null => {
    if (!result) return null;
    const usable =
      result.status === "verified" ||
      result.status === "soft_match" ||
      (allowMismatch && result.status === "name_mismatch");
    if (!usable) return null;
    return result.registrySpecialtyHe ? "specialist" : "resident";
  };
  const primaryStage = region === "IL" ? stageFrom(verified, true) : null;
  const secondaryStage =
    secondaryRegion === "IL" ? stageFrom(secondaryVerified, false) : null;
  const careerStage =
    primaryStage === "specialist" || secondaryStage === "specialist"
      ? "specialist"
      : primaryStage === "resident" || secondaryStage === "resident"
        ? "resident"
        : null;

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
    workplace_type: "hospital" | "clinic";
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
        career_stage: careerStage,

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
