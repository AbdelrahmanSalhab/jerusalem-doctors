// POST /api/signup/start
// Validates the full signup form, re-checks uniqueness + license, persists a
// `pending_signups` row keyed by phone, and triggers Supabase Auth's OTP
// flow (Twilio configured at the Supabase project level). Returns the
// signup session id which the client must echo back to /verify.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { verifyLicense } from "@/lib/moh/match";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { rateLimit } from "@/lib/ratelimit";
import { extractDomain, isInstitutionalEmail } from "@/lib/signup/email-allowlist";
import { isPreApproved } from "@/lib/signup/pre-approved";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";

const PENDING_TTL_MS = 15 * 60_000;

const Body = z.object({
  phone: z.string().min(1),
  license_number: z.string().min(1),
  arabic_first_name: z.string().min(2),
  arabic_family_name: z.string().min(2),
  hebrew_first_name: z.string().min(2),
  hebrew_family_name: z.string().min(2),
  specialty_ids: z.array(z.uuid()).min(1).max(5),
  subspecialty: z.string().trim().optional().nullable(),
  email: z.email(),
  // Workplaces. main_workplace is required (primary). other_workplaces is
  // an unbounded list; we filter empties + dedupe server-side.
  main_workplace: z.string().trim().min(2).max(120),
  other_workplaces: z.array(z.string().trim().min(1).max(120)).default([]),
  consent: z.literal(true),
  turnstile_token: z.string().optional(),
  // Soft-match override flow: client confirms registry name; we record it.
  override_name_mismatch: z.boolean().optional(),
});

export async function POST(req: Request) {
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

  const licenseRaw = parsed.license_number.trim();
  if (!/^\d{1,12}$/.test(licenseRaw)) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: { license_number: "رقم الترخيص يجب أن يحتوي على أرقام فقط" },
    });
  }
  // Normalise to canonical form (strip leading zeros) so that isPreApproved
  // and the uniqueness check match the same representation that check-license
  // uses. An admin pre-approving "00123" sees it stored as "123".
  const license = String(Number(licenseRaw));
  // "0" survives the digit regex above (^\d{1,12}$) but is not a valid MoH
  // license number. Passing it to verifyLicense would produce a misleading
  // not_found audit entry. Reject it explicitly.
  if (license === "0") {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: { license_number: "رقم الترخيص يجب أن يحتوي على أرقام فقط" },
    });
  }

  const service = createSupabaseServiceClient();

  // Defensive uniqueness re-check against race with check-unique.
  const dupe = await service
    .from("doctors")
    .select("id, phone_e164, license_number")
    .or(`phone_e164.eq.${phoneE164},license_number.eq.${license}`)
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

  // Defensive MoH re-check. Cheap and the result is cached on the client.
  const verified = await verifyLicense(service, {
    licenseNumber: Number(license),
    hebrewFirstName: parsed.hebrew_first_name,
    hebrewFamilyName: parsed.hebrew_family_name,
  });

  // Issue #19: not_found 409s without OTP unless the license is on the
  // admin pre-approved allowlist.
  if (verified.status === "not_found") {
    const allowed = await isPreApproved(service, license);
    if (!allowed) {
      // Consume the dedicated not_found bucket BEFORE writing the audit row so
      // that rate-limited probes do not produce unbounded DB writes. Once the
      // bucket is exhausted, we return 429 immediately without any audit insert
      // (the Upstash counter is the authoritative record of abuse volume).
      const rlNotFound = await rateLimit("signupStartNotFound", `ip:${ip}`);
      if (!rlNotFound.success) {
        // After the bucket runs out, return 429 so the attacker cannot tell
        // whether further licenses would also be not_found.
        return jsonError(429, { error: "rate_limited", code: "rate_limited" });
      }
      await service.from("audit_logs").insert({
        action: "signup_not_found_rejected",
        metadata: {
          ip,
          reason: "not_found",
          // license number deliberately omitted to avoid persisting the
          // attacker's probe payload.
        },
      });
      return jsonError(409, {
        error: "license_not_in_registry",
        code: "license_not_in_registry",
        fields: {
          license_number:
            "رقم الترخيص غير موجود في سجل وزارة الصحة. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.",
        },
      });
    }
    // Pre-approved exception: fall through to the rest of the flow.
  }

  if (verified.status === "name_mismatch" && !parsed.override_name_mismatch) {
    return jsonError(409, {
      error: "license_name_mismatch",
      code: "license_name_mismatch",
      fields: {
        hebrew_full_name: "الاسم العبري لا يطابق سجل وزارة الصحة",
      },
    });
  }

  // Pre-compute normalized columns for the doctors row we'll insert on /verify.
  const arabicFirstNorm = normalizeArabic(parsed.arabic_first_name);
  const arabicFamilyNorm = normalizeArabic(parsed.arabic_family_name);
  const arabicFullNorm = normalizeArabic(
    `${parsed.arabic_first_name} ${parsed.arabic_family_name}`,
  );
  const hebrewFirstStored = normalizeHebrew(parsed.hebrew_first_name);
  const hebrewFamilyStored = normalizeHebrew(parsed.hebrew_family_name);
  const subspecialtyNorm = parsed.subspecialty
    ? normalizeArabic(parsed.subspecialty)
    : null;

  // Build the workplace list: primary first, then deduped + non-empty others.
  const seenWp = new Set<string>();
  const mainWp = parsed.main_workplace.trim();
  seenWp.add(normalizeArabic(mainWp));
  const workplaces: { name: string; name_normalized: string; is_primary: boolean; sort_order: number }[] = [
    { name: mainWp, name_normalized: normalizeArabic(mainWp), is_primary: true, sort_order: 0 },
  ];
  let order = 1;
  for (const raw of parsed.other_workplaces) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const norm = normalizeArabic(trimmed);
    if (seenWp.has(norm)) continue;
    seenWp.add(norm);
    workplaces.push({
      name: trimmed,
      name_normalized: norm,
      is_primary: false,
      sort_order: order++,
    });
  }

  const now = Date.now();
  const expiresAt = new Date(now + PENDING_TTL_MS).toISOString();

  // Pre-compute email signals for the pending payload so /verify can
  // insert them into the doctors row without re-deriving them.
  const emailDomain = extractDomain(parsed.email) ?? "";
  const emailIsInstitutional = isInstitutionalEmail(parsed.email);

  const insert = await service
    .from("pending_signups")
    .insert({
      phone_e164: phoneE164,
      payload: {
        phone_e164: phoneE164,
        phone_display: parsed.phone.trim(),
        license_number: license,

        arabic_first_name: parsed.arabic_first_name.trim(),
        arabic_family_name: parsed.arabic_family_name.trim(),
        arabic_first_name_normalized: arabicFirstNorm,
        arabic_family_name_normalized: arabicFamilyNorm,
        arabic_full_name_normalized: arabicFullNorm,

        hebrew_first_name: hebrewFirstStored,
        hebrew_family_name: hebrewFamilyStored,

        subspecialty: parsed.subspecialty?.trim() || null,
        subspecialty_normalized: subspecialtyNorm,
        email: parsed.email.trim(),
        email_domain: emailDomain,
        email_is_institutional: emailIsInstitutional,

        specialty_ids: parsed.specialty_ids,
        workplaces,

        license_verification_status: licenseStatusToColumn(
          verified.status,
          parsed.override_name_mismatch,
        ),
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
    email_is_institutional: emailIsInstitutional,
  });
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

function zodFields(e: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of e.issues) {
    const key = issue.path.map(String).join(".") || "_";
    fields[key] = issue.message;
  }
  return fields;
}
