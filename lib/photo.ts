// Where a doctor's profile photo lives: one object per doctor in a public
// bucket, named by id, with the extension of its sniffed type.

import type { ImageType } from "@/lib/imageType";

export const PHOTO_BUCKET = "doctor-photos";

export const PHOTO_EXT: Record<ImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const photoPath = (doctorId: string, type: ImageType) =>
  `${doctorId}.${PHOTO_EXT[type]}`;

/** Every name the doctor's photo could have, for deleting it. */
export const allPhotoPaths = (doctorId: string) =>
  Object.values(PHOTO_EXT).map((ext) => `${doctorId}.${ext}`);
