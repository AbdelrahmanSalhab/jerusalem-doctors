// POST /api/admin/doctors/[id]/photo — an admin replacing a doctor's photo.
// DELETE /api/admin/doctors/[id]/photo — taking one down.
//
// A sibling route rather than a doctor_id field on /api/profile/photo: every
// write to someone else's row lives under /api/admin, so no route ever has a
// "…unless the caller is an admin" branch to get wrong later.

import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { writeAudit } from "@/lib/audit";
import { removeDoctorPhoto, uploadDoctorPhoto } from "@/lib/profile/photoUpload";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type Ctx = { params: Promise<{ id: string }> };

async function doctorExists(service: ReturnType<typeof createSupabaseServiceClient>, id: string) {
  const found = await service.from("doctors").select("id").eq("id", id).maybeSingle();
  if (found.error && found.error.code !== "PGRST116") throw found.error;
  return Boolean(found.data);
}

export const POST = withJsonErrors(async (req: Request, ctx: Ctx) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const rl = await rateLimit("adminPhotoUpload", `admin:${admin.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const { id } = await ctx.params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, { error: "no_file", code: "no_file" });
  }

  const service = createSupabaseServiceClient();
  if (!(await doctorExists(service, id))) {
    return jsonError(404, { error: "not_found", code: "not_found" });
  }

  const result = await uploadDoctorPhoto(service, id, file, "admin.photo");
  if ("error" in result) {
    return jsonError(result.error.status, { error: result.error.code, code: result.error.code });
  }

  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "admin_doctor_photo_changed",
    target_doctor_id: id,
    metadata: { removed: false },
  });

  return jsonOk({ ok: true, url: result.url });
});

export const DELETE = withJsonErrors(async (_req: Request, ctx: Ctx) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const { id } = await ctx.params;
  const service = createSupabaseServiceClient();
  if (!(await doctorExists(service, id))) {
    return jsonError(404, { error: "not_found", code: "not_found" });
  }

  const failure = await removeDoctorPhoto(service, id, "admin.photo");
  if (failure) return jsonError(failure.status, { error: failure.code, code: failure.code });

  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "admin_doctor_photo_changed",
    target_doctor_id: id,
    metadata: { removed: true },
  });

  return jsonOk({ ok: true, url: null });
});
