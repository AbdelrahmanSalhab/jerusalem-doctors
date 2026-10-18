// POST /api/signup/check-unique
// Pre-OTP guard: tells the form whether the license number is free. The phone
// is deliberately not checked: answering "registered" for a phone would make
// this an oracle for who is in the directory. A registered phone continues to
// the OTP step, where signup/start turns it into a login.
// No PII written; only counts (read).
//
// Gated by Turnstile (pentest finding M1). Licenses are public in the MoH
// registry, so naming a duplicate one gives nothing away.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { canonicalLicenseNumber, licenseFormatErrorMessage } from "@/lib/normalize/license";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";

const Body = z.object({
  phone: z.string().min(1),
  license_region: z.enum(["IL", "PS"]).default("IL"),
  license_number: z.string().min(1),
  turnstile_token: z.string().optional(),
});

export const POST = withJsonErrors(async (req: Request) => {
  const ip = ipFromHeaders(req);
  const rl = await rateLimit("signupCheckUnique", `ip:${ip}`);
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

  // Still validated, so a typo is flagged on the form before the OTP step.
  try {
    normalizePhone(parsed.phone);
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

  const region = parsed.license_region;
  // Uniqueness has to run on the canonical serial: `1-189371`, `1189371` and
  // `189371` are one license, and comparing the raw input would let the same
  // doctor through twice under different spellings.
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

  const supabase = createSupabaseServiceClient();

  const licHit = await supabase
    .from("doctors")
    .select("id", { count: "exact", head: true })
    .eq("license_region", region)
    .eq("license_number", license);
  if (licHit.error) throw licHit.error;
  if ((licHit.count ?? 0) > 0) {
    return jsonOk({
      available: false,
      duplicate_field: "license_number" as const,
    });
  }

  return jsonOk({ available: true });
});
