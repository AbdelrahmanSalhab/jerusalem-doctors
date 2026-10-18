// PATCH /api/admin/doctors/[id]
// Admin-only moderation toggles for is_admin_approved + is_active, the
// career stage, and the dashboard's featured sections.
// DELETE /api/admin/doctors/[id]
// Completes a deletion: erases the doctor's row (workplaces, specialties and
// licenses cascade), their photo and their login. This is what the privacy
// page promises after a deletion request.
// Audit-logs every state change.

import { z } from "zod";
import { CAREER_STAGES, RESIDENCY_YEAR_MIN } from "@/lib/careerStage";
import { FEATURED_KINDS } from "@/lib/directory";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/session";
import { allPhotoPaths, PHOTO_BUCKET } from "@/lib/photo";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";

const Body = z.object({
  is_admin_approved: z.boolean().optional(),
  is_active: z.boolean().optional(),
  is_visible: z.boolean().optional(),
  // An explicit null is a present key, so it survives the no_fields guard
  // below and reaches .update() as a real NULL — that's how an admin sets a
  // doctor back to طب عام.
  career_stage: z.enum(CAREER_STAGES).nullable().optional(),
  residency_start_year: z
    .number()
    .int()
    .min(RESIDENCY_YEAR_MIN)
    .max(2100)
    .nullable()
    .optional(),
  // null takes the doctor out of the featured sections.
  featured: z.enum(FEATURED_KINDS).nullable().optional(),
});

export const PATCH = withJsonErrors(async (
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) => {
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
  // Re-featuring bumps featured_at, so the newest pick leads the section.
  const updates =
    body.featured === undefined
      ? body
      : { ...body, featured_at: body.featured ? new Date().toISOString() : null };
  const r = await service.from("doctors").update(updates).eq("id", id);
  if (r.error) {
    console.error("[admin.doctors.patch] update failed", r.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }

  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "admin_doctor_updated",
    target_doctor_id: id,
    metadata: body,
  });

  return jsonOk({ ok: true });
});

export const DELETE = withJsonErrors(async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) => {
  const admin = await requireAdminOrNull();
  if (!admin) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }
  const { id } = await ctx.params;
  if (id === admin.id) {
    return jsonError(409, { error: "cannot_delete_self", code: "cannot_delete_self" });
  }

  const service = createSupabaseServiceClient();
  const found = await service
    .from("doctors")
    .select("id, is_active, auth_user_id")
    .eq("id", id)
    .maybeSingle();
  if (found.error && found.error.code !== "PGRST116") throw found.error;
  if (!found.data) {
    return jsonError(404, { error: "not_found", code: "not_found" });
  }
  // Only a suspended account (a deletion request suspends it) can be erased,
  // so one misclick on an active doctor can't destroy them.
  if (found.data.is_active) {
    return jsonError(409, { error: "still_active", code: "still_active" });
  }

  // Order makes every step safe to retry: the row goes last, so a failure
  // earlier leaves it listed for the admin to press delete again. Deleting
  // the login first also nulls doctors.auth_user_id (on delete set null).
  const photos = await service.storage.from(PHOTO_BUCKET).remove(allPhotoPaths(id));
  if (photos.error) {
    console.error("[admin.doctors.delete] photo removal failed", photos.error);
    return jsonError(500, { error: "delete_failed", code: "delete_failed" });
  }
  if (found.data.auth_user_id) {
    const user = await service.auth.admin.deleteUser(found.data.auth_user_id);
    if (user.error && user.error.status !== 404) {
      console.error("[admin.doctors.delete] auth user removal failed", user.error);
      return jsonError(500, { error: "delete_failed", code: "delete_failed" });
    }
  }
  const row = await service.from("doctors").delete().eq("id", id);
  if (row.error) {
    console.error("[admin.doctors.delete] row removal failed", row.error);
    return jsonError(500, { error: "delete_failed", code: "delete_failed" });
  }

  // No personal data in the trail: the row it would describe is gone.
  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "admin_doctor_deleted",
    target_doctor_id: null,
    metadata: { deleted_doctor_id: id },
  });

  return jsonOk({ ok: true });
});

async function requireAdminOrNull() {
  try {
    return await requireAdmin();
  } catch {
    return null;
  }
}
