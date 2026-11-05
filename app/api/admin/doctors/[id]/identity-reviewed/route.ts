// POST /api/admin/doctors/[id]/identity-reviewed, an admin has satisfied
// themselves an accepted doctor is who they say (#16). The doctors accepted at
// signup by a registry match alone, before every acceptance asked how the admin
// knew, are cleared this way, one at a time: «لم تُراجَع هويته» lists them.
// Needs the method and the reason, like accepting; both go to the activity log.

import { z } from "zod";
import { APPROVAL_METHOD_KEYS, APPROVAL_REASON_MIN } from "@/lib/admin/approvalMethods";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { writeAudit } from "@/lib/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  approval_method: z.enum(APPROVAL_METHOD_KEYS),
  approval_reason: z.string().trim().min(APPROVAL_REASON_MIN).max(300),
});

export const POST = withJsonErrors(async (
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, { error: "approval_reason_required", code: "approval_reason_required" });

  const service = createSupabaseServiceClient();
  const found = await service.from("doctors").select("id, is_admin, is_visible, is_admin_approved, identity_reviewed_at").eq("id", id).maybeSingle();
  if (found.error && found.error.code !== "PGRST116") throw found.error;
  if (!found.data) return jsonError(404, { error: "not_found", code: "not_found" });
  // Accepting is where a waiting doctor is reviewed; this is for the accepted.
  if (!found.data.is_admin_approved) return jsonError(409, { error: "not_accepted", code: "not_accepted" });
  // A hidden admin account is staff, not a doctor with an identity to satisfy.
  if (found.data.is_admin && !found.data.is_visible) return jsonError(409, { error: "staff_account", code: "staff_account" });
  // A second admin's click: nothing to do.
  if (found.data.identity_reviewed_at) return jsonOk({ ok: true, unchanged: true });

  const at = new Date().toISOString();
  // Only while it is still unreviewed, so two admins cannot both write it.
  const r = await service
    .from("doctors")
    .update({ identity_reviewed_at: at })
    .eq("id", id)
    .is("identity_reviewed_at", null)
    .select("id");
  if (r.error) {
    console.error("[admin.identity-reviewed] update failed", r.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }
  // Lost the race to another admin: their entry is the one in the log.
  if (!r.data || r.data.length === 0) return jsonOk({ ok: true, unchanged: true });
  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "admin_identity_reviewed",
    target_doctor_id: id,
    metadata: parsed.data,
  });
  return jsonOk({ ok: true });
});
