// POST /api/signup/check-license
// Cross-checks (license, Hebrew name) against the MoH registry mirror
// (data.gov.il, see plan §13). Called after check-unique, before /start.
//
// Outcomes:
//   { status: "verified" }                            — proceed to /start, auto-approve later
//   { status: "soft_match", registry_first/family }   — confirm-then-proceed (admin queue)
//   { status: "name_mismatch", registry_first/family} — block; ask user to retype
//   { status: "not_found" }                           — proceed to /start; admin queue

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { verifyLicense } from "@/lib/moh/match";
import { canonicalLicenseNumber, licenseFormatErrorMessage } from "@/lib/normalize/license";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";

const Body = z.object({
  license_number: z.union([z.string(), z.number()]),
  hebrew_first_name: z.string().min(1),
  hebrew_family_name: z.string().min(1),
  turnstile_token: z.string().optional(),
});

export const POST = withJsonErrors(async (req: Request) => {
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

  // The registry mirror is keyed on the bare serial, so a number typed in
  // the form the MoH site displays (`1-189371`, or `1189371` once the hyphen
  // is dropped) has to lose its profession prefix before the lookup.
  const raw = String(parsed.license_number).trim();
  const canonical = canonicalLicenseNumber("IL", raw);
  if (canonical === null) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: { license_number: licenseFormatErrorMessage("IL", raw) },
    });
  }
  const license = Number(canonical);

  const supabase = createSupabaseServiceClient();

  try {
    const result = await verifyLicense(supabase, {
      licenseNumber: license,
      hebrewFirstName: parsed.hebrew_first_name,
      hebrewFamilyName: parsed.hebrew_family_name,
    });

    return jsonOk({
      status: result.status,
      // Echo the serial we actually looked up so the form can show the
      // doctor the number as the registry knows it.
      license_number: canonical,
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
});
