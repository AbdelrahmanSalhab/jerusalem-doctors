// POST /api/mfa/verify: the 6-digit code from the authenticator. With a
// factorId it confirms a new factor (the end of enrolment); without, it
// answers the challenge of a password sign-in. Either way the session leaves
// as aal2, which is what lib/auth/mfa.ts looks for.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit";
import { requireDoctor } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({ code: z.string().regex(/^\d{6}$/), factorId: z.string().uuid().optional() });

export const POST = withJsonErrors(async (req: Request) => {
  const me = await requireDoctor().catch(() => null);
  if (!me?.is_admin || !me.auth_user_id) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  const rl = await rateLimit("mfaVerify", `doctor:${me.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const mfa = (await createSupabaseServerClient()).auth.mfa;
  // A sign-in answers its own verified factor; only enrolment names one.
  const factorId = parsed.data.factorId ?? (await mfa.listFactors()).data?.totp[0]?.id;
  if (!factorId) return jsonError(400, { error: "no_factor", code: "no_factor" });

  const { error } = await mfa.challengeAndVerify({ factorId, code: parsed.data.code });
  if (error) return jsonError(400, { error: "wrong_code", code: "wrong_code" });

  if (parsed.data.factorId) {
    await writeAudit(createSupabaseServiceClient(), { actor_doctor_id: me.id, action: "admin_mfa_enrolled", target_doctor_id: me.id });
  }
  return jsonOk({ ok: true });
});
