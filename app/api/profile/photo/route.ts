// POST /api/profile/photo — uploads a profile picture for the signed-in
// doctor to Supabase Storage bucket "doctor-photos" and updates the doctor's
// profile_picture_url.
//
// Body: multipart/form-data with field "file" (≤ 2MB, image/jpeg|png|webp).

import { jsonError, jsonOk } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const BUCKET = "doctor-photos";

export async function POST(req: Request) {
  const me = await requireDoctor().catch(() => null);
  if (!me) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, { error: "no_file", code: "no_file" });
  }

  if (file.size > MAX_BYTES) {
    return jsonError(413, { error: "file_too_large", code: "file_too_large" });
  }
  if (!ACCEPTED.has(file.type)) {
    return jsonError(415, {
      error: "unsupported_type",
      code: "unsupported_type",
    });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${me.id}.${ext}`;
  const service = createSupabaseServiceClient();

  // Upload (overwrites previous photo at the same path).
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: true,
      cacheControl: "60",
    });
  if (uploadErr) {
    console.error("[profile.photo] storage upload failed", uploadErr);
    return jsonError(500, { error: "upload_failed", code: "upload_failed" });
  }

  const { data: pub } = service.storage.from(BUCKET).getPublicUrl(path);
  // Cache-bust on overwrite by appending a version param.
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: updateErr } = await service
    .from("doctors")
    .update({ profile_picture_url: url })
    .eq("id", me.id);
  if (updateErr) {
    console.error("[profile.photo] db update failed", updateErr);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }

  await service.from("audit_logs").insert({
    actor_doctor_id: me.id,
    action: "profile_photo_uploaded",
    target_doctor_id: me.id,
    metadata: { size: file.size, content_type: file.type },
  });

  return jsonOk({ ok: true, url });
}
