// POST /api/profile/photo, uploads a profile picture for the signed-in
// doctor to Supabase Storage bucket "doctor-photos" and updates the doctor's
// profile_picture_url.
//
// Body: multipart/form-data with field "file" (≤ 2MB, image/jpeg|png|webp).
// The upload itself lives in lib/profile/photoUpload.ts, shared with the
// admin's route; this one only decides that the doctor may write their own.

import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { uploadDoctorPhoto } from "@/lib/profile/photoUpload";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

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

  const service = createSupabaseServiceClient();
  const result = await uploadDoctorPhoto(service, me.id, file, "profile.photo");
  if ("error" in result) {
    return jsonError(result.error.status, { error: result.error.code, code: result.error.code });
  }

  return jsonOk({ ok: true, url: result.url });
});
