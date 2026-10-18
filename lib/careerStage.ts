// Career stage — self-declared at signup, editable afterwards from /profile
// and /admin.
//
// It used to be derived from the Israeli MoH registry: a row with no
// `שם התמחות` was read as "resident". That inference was wrong. A blank
// specialty means "holds no board certificate", which is equally true of a
// general practitioner who never pursued one, so long-practising GPs were
// being badged طبيب مقيم on the public cards. The registry publishes nothing
// that separates the two, so the doctor now tells us.
//
// The UI offers three choices; the column still holds two values, with طب عام
// represented by NULL. Everything each choice implies — which specialties are
// offered, which workplace types, whether a residency year is asked for —
// lives in STAGE_OPTIONS so the two forms and the admin table agree.

import { type WorkplaceType, WORKPLACE_TYPES } from "@/lib/workplace";

/** The two values doctors.career_stage can hold. NULL means طب عام. */
export const CAREER_STAGES = ["resident", "specialist"] as const;
export type CareerStage = (typeof CAREER_STAGES)[number];

/** The 3-way choice shown to the doctor. Maps onto `CareerStage | null`. */
export type Stage = "general" | "resident" | "specialist";

export interface StageOption {
  readonly stage: Stage;
  readonly label: string;
  /** Narrow variant for the admin table's segmented control. */
  readonly shortLabel: string;
  readonly hint: string;
  /** What lands in doctors.career_stage. */
  readonly careerStage: CareerStage | null;
  readonly showsSpecialtyPicker: boolean;
  readonly autoAttachesGeneralSpecialty: boolean;
  readonly excludesGeneralSpecialty: boolean;
  readonly requiresResidencyStartYear: boolean;
  readonly workplaceTypes: readonly WorkplaceType[];
  readonly defaultWorkplaceType: WorkplaceType;
  /** Only a specialist's عيادة asks for address, hours and phone. */
  readonly showsClinicFields: boolean;
  /** A resident rotates during training, so no fixed workplace is required. */
  readonly workplaceOptional: boolean;
  /** طب عام lists extra certificates in place of a specialty (0013). */
  readonly showsCertificates: boolean;
}

export const STAGE_OPTIONS: readonly StageOption[] = [
  {
    stage: "general",
    label: "طب عام",
    shortLabel: "طب عام",
    hint: "طبيب عام — بدون شهادة تخصص",
    careerStage: null,
    showsSpecialtyPicker: false,
    autoAttachesGeneralSpecialty: true,
    excludesGeneralSpecialty: false,
    requiresResidencyStartYear: false,
    workplaceTypes: ["hospital", "clinic"],
    defaultWorkplaceType: "clinic",
    showsClinicFields: false,
    workplaceOptional: false,
    showsCertificates: true,
  },
  {
    stage: "resident",
    label: "طبيب مقيم",
    shortLabel: "مقيم",
    hint: "أتدرّب حاليًا في تخصص",
    careerStage: "resident",
    showsSpecialtyPicker: true,
    autoAttachesGeneralSpecialty: false,
    excludesGeneralSpecialty: true,
    requiresResidencyStartYear: true,
    workplaceTypes: ["hospital", "hmo"],
    defaultWorkplaceType: "hospital",
    showsClinicFields: false,
    workplaceOptional: true,
    showsCertificates: false,
  },
  {
    stage: "specialist",
    label: "طبيب أخصائي",
    shortLabel: "أخصائي",
    hint: "أحمل شهادة تخصص",
    careerStage: "specialist",
    showsSpecialtyPicker: true,
    autoAttachesGeneralSpecialty: false,
    excludesGeneralSpecialty: true,
    requiresResidencyStartYear: false,
    workplaceTypes: ["hospital", "clinic"],
    defaultWorkplaceType: "hospital",
    showsClinicFields: true,
    workplaceOptional: false,
    showsCertificates: false,
  },
];

export const STAGE_BY_KEY: Record<Stage, StageOption> = Object.fromEntries(
  STAGE_OPTIONS.map((o) => [o.stage, o]),
) as Record<Stage, StageOption>;

/**
 * NULL reads as طب عام. Callers that must tell a declared GP apart from a
 * legacy row that never declared anything check `career_stage === null`
 * themselves before calling — /profile does exactly that, so opening the page
 * and saving an unrelated field can't silently re-label the doctor.
 */
export function stageFromCareerStage(cs: CareerStage | null): Stage {
  return cs === null ? "general" : cs;
}

/**
 * The stage /profile opens with. NULL is both a declared طب عام and a legacy
 * row that never chose; only the first carries الطب العام and nothing else
 * (the stage attaches it), so that is what tells them apart. Anything else
 * stays undeclared (null) for the reason given on stageFromCareerStage.
 */
export function initialProfileStage(
  cs: CareerStage | null,
  specialtyIds: readonly string[],
  generalSpecialtyId: string | null,
): Stage | null {
  if (cs !== null) return cs;
  const onlyGeneral =
    generalSpecialtyId !== null &&
    specialtyIds.length === 1 &&
    specialtyIds[0] === generalSpecialtyId;
  return onlyGeneral ? "general" : null;
}

/** Public badge label. NULL career_stage renders no badge at all. */
export const CAREER_STAGE_LABEL: Record<CareerStage, string> = {
  resident: "طبيب مقيم",
  specialist: "طبيب أخصائي",
};

export const RESIDENCY_YEAR_MIN = 1950;
export const residencyYearMax = (now: Date = new Date()): number =>
  now.getFullYear();

export function isValidResidencyYear(v: string | number | null): boolean {
  if (v === null || v === "") return false;
  const n = typeof v === "number" ? v : Number(v);
  return (
    Number.isInteger(n) && n >= RESIDENCY_YEAR_MIN && n <= residencyYearMax()
  );
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

/**
 * 2022 → "٢٠٢٢". A plain digit map rather than Intl: deterministic across
 * Node ICU builds, and no `useGrouping: false` to forget — ar-EG would
 * otherwise render a year as ٢٬٠٢٢.
 */
export function toArabicIndicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => ARABIC_INDIC[Number(d)]);
}

/** "طبيب مقيم · منذ ٢٠٢٢" — the year only ever qualifies a resident. */
export function careerStageBadge(
  careerStage: CareerStage,
  residencyStartYear: number | null,
): string {
  const label = CAREER_STAGE_LABEL[careerStage];
  return careerStage === "resident" && residencyStartYear
    ? `${label} · منذ ${toArabicIndicDigits(residencyStartYear)}`
    : label;
}

/**
 * Coerce a workplace to what the stage allows: an illegal type falls back to
 * the stage's default, and the clinic fields (address, hours, phone and the
 * legacy `details`) are dropped whenever the resulting row hides them. Every
 * type change goes through here, so switching عيادة → مستشفى can't leave
 * typed clinic hours in state and post them.
 */
export function workplaceForStage<
  T extends { workplace_type: WorkplaceType } & ClinicFields,
>(w: T, stage: Stage): T {
  const opt = STAGE_BY_KEY[stage];
  const type = opt.workplaceTypes.includes(w.workplace_type)
    ? w.workplace_type
    : opt.defaultWorkplaceType;
  const keepClinic = opt.showsClinicFields && type === "clinic";
  const hasClinic = CLINIC_KEYS.some((k) => w[k] !== "");
  if (type === w.workplace_type && (keepClinic || !hasClinic)) return w;
  return keepClinic
    ? { ...w, workplace_type: type }
    : { ...w, workplace_type: type, details: "", address: "", hours: "", phone: "" };
}

type ClinicFields = { details: string; address: string; hours: string; phone: string };
const CLINIC_KEYS = ["details", "address", "hours", "phone"] as const;

export const GENERAL_SPECIALTY_CODE = "general";

/**
 * Resolve the الطب العام row. Prefers the stable `code` column (0009) and
 * falls back to the display name so the app keeps working before that
 * migration lands — and so a `null` here never strands the form.
 */
export function findGeneralSpecialtyId(
  specialties: { id: string; name_ar: string; code?: string | null }[],
): string | null {
  const byCode = specialties.find((s) => s.code === GENERAL_SPECIALTY_CODE);
  if (byCode) return byCode.id;
  return specialties.find((s) => s.name_ar === "الطب العام")?.id ?? null;
}

export { WORKPLACE_TYPES };
export type { WorkplaceType };
