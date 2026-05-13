// PATCH /api/admin/doctors/[id]
// Admin-only moderation toggles for is_admin_approved + is_active.
// Audit-logs every state change. When approving a doctor whose email has not
// been verified yet, writes an additional audit row so the override is on
// record.

import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  is_admin_approved: z.boolean().optional(),
  is_active: z.boolean().optional(),
  user_chose_visible: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminOrNull();
  if (!admin) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const { id } = await ctx.params;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }
  if (Object.keys(body).length === 0) {
    return jsonError(400, { error: "no_fields", code: "no_fields" });
  }

  const service = createSupabaseServiceClient();

  // When approving a doctor whose email has not been verified yet, record the
  // override so it's auditable. This does not block the approval — admin
  // override is intentional.
  if (body.is_admin_approved === true) {
    const target = await service
      .from("doctors")
      .select("id, email_verified_at")
      .eq("id", id)
      .maybeSingle();
    if (target.data && !target.data.email_verified_at) {
      await service.from("audit_logs").insert({
        actor_doctor_id: admin.id,
        action: "admin_approved_without_email_verification",
        target_doctor_id: id,
        metadata: { override: true },
      });
    }
  }

  // Re-approval invariant: when a doctor transitions from is_admin_approved=false
  // to is_admin_approved=true, their missing_sync_count may have accumulated stale
  // bumps from revocation_sweep() cycles that ran while they were unapproved (step 1
  // of the sweep skips unapproved doctors, but the counter is not automatically reset
  // on re-approval). Without this reset, a freshly re-approved doctor immediately
  // becomes a revocation candidate on the next sweep even if they have not missed any
  // cycles since re-approval. Resetting to 0 and refreshing last_seen_in_moh_at to
  // now() gives the doctor a clean slate consistent with the sweep's semantics.
  const updatePayload: Record<string, unknown> = { ...body };
  if (body.is_admin_approved === true) {
    updatePayload.missing_sync_count = 0;
    updatePayload.last_seen_in_moh_at = new Date().toISOString();
  }

  const r = await service.from("doctors").update(updatePayload).eq("id", id);
  if (r.error) {
    console.error("[admin.doctors.patch] update failed", r.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }

  await service.from("audit_logs").insert({
    actor_doctor_id: admin.id,
    action: "admin_doctor_updated",
    target_doctor_id: id,
    metadata: body,
  });

  return jsonOk({ ok: true });
}

async function requireAdminOrNull() {
  try {
    return await requireAdmin();
  } catch {
    return null;
  }
}
