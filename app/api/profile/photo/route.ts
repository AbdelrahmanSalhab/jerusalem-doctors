// POST /api/profile/photo — uploads a profile picture for the signed-in
// doctor to Supabase Storage bucket "doctor-photos" and updates the doctor's
// profile_picture_url.
//
// Body: multipart/form-data with field "file" (≤ 2MB, image/jpeg|png|webp).

import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { sniffImageType, type ImageType } from "@/lib/imageType";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const EXT: Record<ImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const BUCKET = "doctor-photos";

export const POST = withJsonErrors(async (req: Request) => {
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
  // The type comes from the bytes; file.type is whatever the client claims.
  const arrayBuffer = await file.arrayBuffer();
  const type = sniffImageType(new Uint8Array(arrayBuffer));
  if (!type) {
    return jsonError(415, {
      error: "unsupported_type",
      code: "unsupported_type",
    });
  }

  const path = `${me.id}.${EXT[type]}`;
  const service = createSupabaseServiceClient();

  // Upload (overwrites previous photo at the same path).
  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, {
      contentType: type,
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

  return jsonOk({ ok: true, url });
});
