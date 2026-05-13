// POST /api/signup/check-license
// Cross-checks (license, Hebrew name) against the MoH registry mirror
// (data.gov.il, see plan §13). Called after check-unique, before /start.
//
// Outcomes:
//   { status: "verified" }                            — proceed to /start
//   { status: "soft_match", registry_first/family }   — confirm-then-proceed (admin queue)
//   { status: "name_mismatch", registry_first/family} — block; ask user to retype
//   { status: "not_found" }                           — 409 unless pre-approved (#19)

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { verifyLicense } from "@/lib/moh/match";
import { rateLimit } from "@/lib/ratelimit";
import { isPreApproved } from "@/lib/signup/pre-approved";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";

const Body = z.object({
  license_number: z.union([z.string(), z.number()]),
  hebrew_first_name: z.string().min(1),
  hebrew_family_name: z.string().min(1),
  turnstile_token: z.string().optional(),
});

export async function POST(req: Request) {
  const ip = ipFromHeaders(req);

  const rl = await rateLimit("signupCheckLicense", `ip:${ip}`);
  if (!rl.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

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

  const license = Number(
    typeof parsed.license_number === "string"
      ? parsed.license_number.trim()
      : parsed.license_number,
  );
  if (!Number.isInteger(license) || license <= 0) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: { license_number: "رقم الترخيص يجب أن يكون رقمًا صحيحًا" },
    });
  }

  const supabase = createSupabaseServiceClient();

  try {
    const result = await verifyLicense(supabase, {
      licenseNumber: license,
      hebrewFirstName: parsed.hebrew_first_name,
      hebrewFamilyName: parsed.hebrew_family_name,
    });

    // Issue #19: not_found 409s at this step too so the UI gives the same
    // message early (rather than waiting until /start). Exception: the
    // license is on the admin pre-approved list.
    if (result.status === "not_found") {
      const licenseStr = String(license);
      if (!(await isPreApproved(supabase, licenseStr))) {
        // Apply the same tight per-IP bucket used in /start for not_found probes
        // so that check-license cannot be used as a cheaper enumeration oracle.
        const rlNotFound = await rateLimit("signupStartNotFound", `ip:${ip}`);
        if (!rlNotFound.success) {
          return jsonError(429, { error: "rate_limited", code: "rate_limited" });
        }
        // Write a forensic audit row so probing via check-license is recorded
        // consistently with probing via /start.
        await supabase.from("audit_logs").insert({
          actor_doctor_id: null,
          action: "signup_not_found_rejected",
          target_doctor_id: null,
          metadata: { license_number: licenseStr, route: "check-license" },
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
    }

    return jsonOk({
      status: result.status,
      registry_first_name: result.registryFirstName,
      registry_family_name: result.registryFamilyName,
      registry_specialty_he: result.registrySpecialtyHe ?? null,
      source: result.source,
    });
  } catch (err) {
    console.error("[check-license] failed", err);
    // Don't leak details. Return a soft "service unavailable" so the UI can
    // still let the user proceed (and land in admin queue).
    return jsonError(503, { error: "moh_unavailable", code: "moh_unavailable" });
  }
}
