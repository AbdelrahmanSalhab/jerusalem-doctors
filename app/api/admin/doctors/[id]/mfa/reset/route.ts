// POST /api/admin/doctors/[id]/mfa/reset: a super admin (lib/auth/superAdmin.ts)
// removes another admin's authenticator, for a lost phone. The admin then has
// 15 minutes to enrol a new one from «ملفي». Answers 404 to every other admin, so
// the route does not announce itself.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { resetSecondFactor } from "@/lib/auth/mfaReset";
import { isSuperAdmin } from "@/lib/auth/superAdmin";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const notFound = () => jsonError(404, { error: "not_found", code: "not_found" });

export const POST = withJsonErrors(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const service = createSupabaseServiceClient();
  if (!(await isSuperAdmin(service, admin.auth_user_id))) return notFound();

  const rl = await rateLimit("mfaReset", `admin:${admin.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success || id === admin.id) return notFound();
  const target = await service.from("doctors").select("id, is_admin, auth_user_id").eq("id", id).maybeSingle();
  if (target.error) {
    console.error("[admin.mfa.reset] read failed", target.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }
  if (!target.data?.is_admin || !target.data.auth_user_id) return notFound();

  let removed: number;
  try {
    removed = await resetSecondFactor(service, target.data.auth_user_id);
  } catch (err) {
    console.error("[admin.mfa.reset] failed", (err as Error).message);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }
  await writeAudit(service, { actor_doctor_id: admin.id, action: "admin_mfa_reset", target_doctor_id: id, metadata: { factors: removed } });
  return jsonOk({ ok: true });
});
