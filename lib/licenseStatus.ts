// How a licence verification result is worded, in one place.
//
// The four values are the CHECK constraint on doctors.license_verification_status
// (0001_init.sql) and secondary_license_verification_status (0008_dual_license.sql).
// NULL is a fifth state: a row that was never checked, from before the check
// existed or from a name mismatch the doctor never overrode.
//
// Three screens used to keep their own wording for the same five states, which
// is why an admin could read "تطابق جزئي" in one place and "تطابق تقريبي" in
// another for the same doctor. The short label is for chips, the sentence for
// the activity log.

export const LICENSE_STATUSES = [
  "verified",
  "soft_match",
  "not_found",
  "name_mismatch_overridden",
] as const;

export type LicenseStatusColumn = (typeof LICENSE_STATUSES)[number];

/** What the column actually holds: one of the four, or nothing. */
export type LicenseStatusValue = LicenseStatusColumn | null;

export type StatusTone = "success" | "warn" | "danger" | "neutral";

const LABEL: Record<LicenseStatusColumn, string> = {
  verified: "موثّق",
  soft_match: "تطابق جزئي",
  not_found: "غير موجود في السجل",
  name_mismatch_overridden: "تم التغاضي يدويًا",
};

/** The full sentence used in the activity log. */
const SENTENCE: Record<LicenseStatusColumn, string> = {
  verified: "الترخيص مطابق لسجل الوزارة",
  soft_match: "تطابق تقريبي مع السجل",
  not_found: "الترخيص غير موجود في السجل",
  name_mismatch_overridden: "الاسم لا يطابق السجل (تجاوزه الطبيب)",
};

const TONE: Record<LicenseStatusColumn, StatusTone> = {
  verified: "success",
  soft_match: "warn",
  not_found: "warn",
  name_mismatch_overridden: "danger",
};

/** A licence nobody has checked yet. */
export const UNCHECKED_LABEL = "لم يُتحقق";
export const UNCHECKED_SENTENCE = "لم تُسجَّل نتيجة تحقق";

/** A Palestinian licence: there is no registry to check it against, so the
 *  stored `not_found` says nothing about whether the number is real. */
export const PS_LABEL = "ترخيص فلسطيني";

export function isLicenseStatus(v: unknown): v is LicenseStatusColumn {
  return typeof v === "string" && (LICENSE_STATUSES as readonly string[]).includes(v);
}

export function licenseStatusLabel(v: unknown): string {
  return isLicenseStatus(v) ? LABEL[v] : UNCHECKED_LABEL;
}

export function licenseStatusSentence(v: unknown): string {
  return isLicenseStatus(v) ? SENTENCE[v] : UNCHECKED_SENTENCE;
}

export function licenseStatusTone(v: unknown): StatusTone {
  return isLicenseStatus(v) ? TONE[v] : "neutral";
}

const CHIP_BASE = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs";

const CHIP_TONE: Record<StatusTone, string> = {
  success: "border-success-line bg-success-bg text-success",
  warn: "border-warn-line bg-warn-bg text-warn",
  danger: "border-danger-line bg-danger-bg text-danger",
  neutral: "border-line text-muted",
};

export function toneChip(tone: StatusTone): string {
  return `${CHIP_BASE} ${CHIP_TONE[tone]}`;
}

/**
 * How a licence reads on a chip. A PS licence is its own neutral state: the
 * column says `not_found` because nothing was ever looked up, and showing it
 * as a warning next to real registry misses is what made the admin panel
 * misleading.
 */
export function licenseDisplay(input: {
  status: unknown;
  region?: string | null;
}): { label: string; tone: StatusTone } {
  if (input.region === "PS") return { label: PS_LABEL, tone: "neutral" };
  return { label: licenseStatusLabel(input.status), tone: licenseStatusTone(input.status) };
}

/** Anything short of an exact registry match needs the admin to say why they
 *  are letting the doctor in. */
export function approvalNeedsReason(v: unknown): boolean {
  return v !== "verified";
}
