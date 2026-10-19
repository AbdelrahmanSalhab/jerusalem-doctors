// What a doctor lists beyond their specialty: services and procedures they
// do ("تنظير القولون", "حقن العين") and certificates ("ACLS"). Every stage can
// list them; certificates_normalized feeds the search, so a colleague can
// find "who does colonoscopies". For a طب عام doctor they replace the shared
// الطب العام chip on the card (0013).

import { z } from "zod";
import { normalizeArabic } from "@/lib/normalize/arabic";

export const CERTIFICATES_MAX = 10;
export const CERTIFICATE_MAX_LENGTH = 80;

/** Trims, drops blanks and repeats. Blank rows are what an untouched
 *  "add another" leaves behind, so they are not an error. */
export const CertificatesSchema = z
  .array(z.string().trim().max(CERTIFICATE_MAX_LENGTH))
  .max(CERTIFICATES_MAX)
  .transform((list) => [...new Set(list.filter(Boolean))]);

export function certificatesNormalized(list: readonly string[]): string | null {
  return list.length ? normalizeArabic(list.join(" ")) : null;
}
