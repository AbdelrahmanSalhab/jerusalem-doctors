// The three switches an admin operates on a doctor, and what each one does.
//
// They used to be two buttons reading "إلغاء التفعيل" and "تعليق", which are
// close enough in Arabic that an admin could not tell which one they had just
// pressed, and a third flag (is_visible) that the API accepted but no screen
// ever showed. They are kept as three because they genuinely mean three
// different things:
//
//   is_admin_approved  the gate into the directory, decided once on joining
//   is_active          whether the account works at all
//   is_visible         whether colleagues find them in search
//
// Each one now carries its own label and a line saying what it does, and
// directoryVisibility() answers the question the admin actually has, which is
// whether this doctor is findable right now and if not, why not.

export const STATE_FIELDS = ["is_admin_approved", "is_active", "is_visible"] as const;
export type StateField = (typeof STATE_FIELDS)[number];

export interface StateSwitch {
  field: StateField;
  label: string;
  /** Wording for the switch being on, and for it being off. */
  on: string;
  off: string;
  /** One line on what the setting does, shown next to it. */
  hint: string;
}

export const STATE_SWITCHES: readonly StateSwitch[] = [
  {
    field: "is_admin_approved",
    label: "قبول العضوية",
    on: "مقبول",
    off: "بانتظار القبول",
    hint: "يسمح له بدخول الدليل والبحث. قرار يُتخذ مرة واحدة عند الانضمام.",
  },
  {
    field: "is_active",
    label: "الحساب",
    on: "مفتوح",
    off: "مغلق",
    hint: "مغلق: لا يستطيع الدخول نهائيًا.",
  },
  {
    field: "is_visible",
    label: "الظهور في الدليل",
    on: "ظاهر",
    off: "مخفي",
    hint: "مخفي: لا يراه الأطباء في البحث، لكنه يستطيع الدخول واستخدام الدليل.",
  },
];

export const STATE_GROUP_HEADING = "الحالة";
export const STATE_GROUP_NOTE = "القبول قرار لمرّة واحدة؛ الحساب والظهور إعدادان يمكن تغييرهما في أي وقت.";

/** The state of one switch, in words. */
export function switchState(sw: StateSwitch, on: boolean): string {
  return on ? sw.on : sw.off;
}

export interface VisibilityFlags {
  is_admin_approved: boolean;
  is_active: boolean;
  is_visible: boolean;
  is_phone_verified: boolean;
  consent_directory_use: boolean;
}

export interface DirectoryVisibility {
  listed: boolean;
  /** Every reason this doctor is not in the directory, most decisive first. */
  blockers: string[];
  /** The whole answer in one line, for the panel. */
  sentence: string;
}

/**
 * Whether a doctor is in the directory right now, mirroring the five
 * conditions directoryQuery() enforces in lib/directory.ts. Two of them are
 * not switches at all, which is exactly why an admin could flip everything
 * they had and still not see the doctor appear.
 */
export function directoryVisibility(d: VisibilityFlags): DirectoryVisibility {
  const blockers: string[] = [];
  if (!d.is_admin_approved) blockers.push("لم تُقبل عضويته بعد");
  if (!d.is_active) blockers.push("الحساب مغلق");
  if (!d.is_visible) blockers.push("الظهور في الدليل مُخفى");
  if (!d.is_phone_verified) blockers.push("رقم هاتفه غير مُوثّق");
  if (!d.consent_directory_use) blockers.push("لم يوافق على إظهار بياناته في الدليل (لا تستطيع الإدارة تغيير هذا)");

  return {
    listed: blockers.length === 0,
    blockers,
    sentence: blockers.length === 0
      ? "يظهر في الدليل الآن."
      : `لا يظهر في الدليل الآن. السبب: ${blockers.join("، ")}.`,
  };
}

/** The licence placeholder of the CI account (scripts/add-ci-account.ts), the
 *  one the production smoke check signs in as (/api/login/ci). */
export const CI_LICENSE = "CI";

/**
 * Not a doctor: a staff account (an admin hidden from the directory, the same
 * rule admin_stats() and the registry sync use), and among them the CI
 * account. null for a doctor. Their doctor fields are placeholders, so the
 * admin list shows what they are instead.
 */
export function staffKind(row: { is_admin: boolean; is_visible: boolean; license_number: string }): "ci" | "staff" | null {
  if (!row.is_admin || row.is_visible) return null;
  return row.license_number === CI_LICENSE ? "ci" : "staff";
}
