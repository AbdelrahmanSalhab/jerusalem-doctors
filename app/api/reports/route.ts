// POST /api/reports, a signed-in doctor's «أبلغ عن هذا الملف» on a card:
// this profile is not who it says (lib/reports.ts).

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { fileReport } from "@/lib/reports";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  target_doctor_id: z.uuid(),
  details: z.string().trim().min(5).max(1000),
});

export const POST = withJsonErrors(async (req: Request) => {
  const me = await requireDoctor().catch(() => null);
  if (!me) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  if (parsed.data.target_doctor_id === me.id) return jsonError(400, { error: "invalid_body", code: "invalid_body" });

  const rl = await rateLimit("profileReport", `doctor:${me.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  await fileReport(createSupabaseServiceClient(), {
    source: "card",
    target_doctor_id: parsed.data.target_doctor_id,
    reporter_doctor_id: me.id,
    details: parsed.data.details,
  });
  return jsonOk({ ok: true });
});
