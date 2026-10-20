// Uploading a doctor's profile photo, shared by the doctor's own
// /api/profile/photo and an admin's /api/admin/doctors/[id]/photo.
//
// Everything here is about the bytes and the storage object; which doctor id
// the caller is allowed to write belongs to the route, so the two paths can
// never blur into "…unless you are an admin, then write someone else's row".

import type { SupabaseClient } from "@supabase/supabase-js";
import { sniffImageType } from "@/lib/imageType";
import { allPhotoPaths, PHOTO_BUCKET, photoPath } from "@/lib/photo";

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export interface PhotoFailure {
  status: number;
  code: string;
}

export async function uploadDoctorPhoto(
  service: SupabaseClient,
  doctorId: string,
  file: File,
  logPrefix: string,
): Promise<{ url: string } | { error: PhotoFailure }> {
  if (file.size > PHOTO_MAX_BYTES) {
    return { error: { status: 413, code: "file_too_large" } };
  }
  // The type comes from the bytes; file.type is whatever the client claims.
  const arrayBuffer = await file.arrayBuffer();
  const type = sniffImageType(new Uint8Array(arrayBuffer));
  if (!type) {
    return { error: { status: 415, code: "unsupported_type" } };
  }

  const path = photoPath(doctorId, type);
  // Upload (overwrites previous photo at the same path).
  const { error: uploadErr } = await service.storage
    .from(PHOTO_BUCKET)
    .upload(path, arrayBuffer, { contentType: type, upsert: true, cacheControl: "60" });
  if (uploadErr) {
    console.error(`[${logPrefix}] storage upload failed`, uploadErr);
    return { error: { status: 500, code: "upload_failed" } };
  }

  const { data: pub } = service.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  // Cache-bust on overwrite by appending a version param.
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: updateErr } = await service
    .from("doctors")
    .update({ profile_picture_url: url })
    .eq("id", doctorId);
  if (updateErr) {
    console.error(`[${logPrefix}] db update failed`, updateErr);
    return { error: { status: 500, code: "update_failed" } };
  }

  return { url };
}

/** Takes the photo down: every name it could have, then the column. */
export async function removeDoctorPhoto(
  service: SupabaseClient,
  doctorId: string,
  logPrefix: string,
): Promise<PhotoFailure | null> {
  const removed = await service.storage.from(PHOTO_BUCKET).remove(allPhotoPaths(doctorId));
  if (removed.error) {
    console.error(`[${logPrefix}] photo removal failed`, removed.error);
    return { status: 500, code: "upload_failed" };
  }
  const { error } = await service
    .from("doctors")
    .update({ profile_picture_url: null })
    .eq("id", doctorId);
  if (error) {
    console.error(`[${logPrefix}] db update failed`, error);
    return { status: 500, code: "update_failed" };
  }
  return null;
}
