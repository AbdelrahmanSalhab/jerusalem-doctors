// POST /api/reports/public, the /report form: no account needed, for a
// doctor whose licence or number someone else already holds here
// (lib/reports.ts). Turnstile and per-IP limits, like signup.
//
// The answer is the same whether or not the licence matches a profile, so
// the form can't be used to test who is registered.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { rateLimit } from "@/lib/ratelimit";
import { doctorByLicense, fileReport } from "@/lib/reports";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyTurnstile } from "@/lib/turnstile";

const Body = z.object({
  license_number: z.string().trim().max(20).optional().nullable(),
  name: z.string().trim().min(2).max(100),
  contact: z.string().trim().min(5).max(100),
  details: z.string().trim().min(5).max(1000),
  turnstile_token: z.string().optional(),
});

export const POST = withJsonErrors(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, { error: "invalid_body", code: "invalid_body" });

  const ip = ipFromHeaders(req);
  const ts = await verifyTurnstile(parsed.data.turnstile_token, ip);
  if (!ts.ok) return jsonError(403, { error: "turnstile_failed", code: "turnstile_failed" });

  const rl = await rateLimit("profileReportIp", `ip:${ip}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const service = createSupabaseServiceClient();
  const license = parsed.data.license_number || null;
  await fileReport(service, {
    source: "public",
    target_doctor_id: license ? await doctorByLicense(service, license) : null,
    license_number: license,
    reporter_name: parsed.data.name,
    reporter_contact: parsed.data.contact,
    details: parsed.data.details,
  });
  return jsonOk({ ok: true });
});
