// POST /api/signup/check-unique
// Pre-OTP guard: tells the form whether { phone, license_number } is free.
// No PII written; only counts (read).

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  phone: z.string().min(1),
  license_number: z.string().min(1),
});

export async function POST(req: Request) {
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
  if (!/^\d{1,12}$/.test(license)) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: { license_number: "رقم الترخيص يجب أن يحتوي على أرقام فقط" },
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
    .eq("license_number", license);
  if (licHit.error) throw licHit.error;
  if ((licHit.count ?? 0) > 0) {
    return jsonOk({
      available: false,
      duplicate_field: "license_number" as const,
    });
  }

  return jsonOk({ available: true });
}
