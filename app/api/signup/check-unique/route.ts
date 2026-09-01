// POST /api/signup/check-unique
// Pre-OTP guard: tells the form whether { phone, license_number } is free.
// No PII written; only counts (read).
//
// Gated by Turnstile. Without the gate this endpoint becomes a phone/license
// enumeration oracle for anyone who can hit it at scale (pentest finding M1).
// The matching duplicate_field is still returned so the UI can highlight the
// specific input — the Turnstile gate makes that disclosure safe.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { isValidLicenseFormat, licenseFormatErrorMessage } from "@/lib/normalize/license";
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

  const license = parsed.license_number.trim();
  const region = parsed.license_region;
  if (!isValidLicenseFormat(region, license)) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: { license_number: licenseFormatErrorMessage(region) },
    });
  }

  const supabase = createSupabaseServiceClient();

  const phoneHit = await supabase
    .from("doctors")
    .select("id", { count: "exact", head: true })
    .eq("phone_e164", phoneE164);
  if (phoneHit.error) throw phoneHit.error;
  if ((phoneHit.count ?? 0) > 0) {
    return jsonOk({ available: false, duplicate_field: "phone" as const });
  }

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
