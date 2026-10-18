// Extra certificates a طب عام doctor can list (0013). Cards show them in
// place of the الطب العام chip; certificates_normalized feeds the search.

import { z } from "zod";
import { normalizeArabic } from "@/lib/normalize/arabic";

export const CERTIFICATES_MAX = 5;
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
