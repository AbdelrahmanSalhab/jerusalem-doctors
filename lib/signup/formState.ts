// The signup form's state and the pure transitions on it, kept out of the
// component so they can be tested without rendering.

import { STAGE_BY_KEY, type Stage, workplaceForStage } from "@/lib/careerStage";
import { toAsciiDigits } from "@/lib/normalize/digits";
import { cleanWorkplaces, emptyWorkplace, type WorkplaceEntry } from "@/lib/workplace";

export type LicenseRegion = "IL" | "PS";

export type FormState = {
  phone: string;
  license_region: LicenseRegion;
  license_number: string;
  has_secondary_license: boolean;
  secondary_license_region: LicenseRegion;
  secondary_license_number: string;
  arabic_first_name: string;
  arabic_family_name: string;
  hebrew_first_name: string;
  hebrew_family_name: string;
  /** The 3-way self-declared choice; null until the doctor picks one. */
  stage: Stage | null;
  /** Kept as a string so the controlled number input can be empty. */
  residency_start_year: string;
  specialty_ids: string[];
  subspecialty: string;
  email: string;
  bio: string;
  /** طب عام only; see lib/certificates.ts. */
  certificates: string[];
  seeking_work: boolean;
  /** Independent of seeking_work; either makes the workplace optional. */
  retired: boolean;
  workplaces: WorkplaceEntry[];
  consent: boolean;
  /** Colleagues' numbers stay among doctors (#192). */
  pledge: boolean;
};

export type UpdateField = <K extends keyof FormState>(k: K, v: FormState[K]) => void;

export const OTHER_REGION: Record<LicenseRegion, LicenseRegion> = { IL: "PS", PS: "IL" };

export const INITIAL: FormState = {
  phone: "",
  license_region: "IL",
  license_number: "",
  has_secondary_license: false,
  secondary_license_region: "PS",
  secondary_license_number: "",
  arabic_first_name: "",
  arabic_family_name: "",
  hebrew_first_name: "",
  hebrew_family_name: "",
  stage: null,
  residency_start_year: "",
  specialty_ids: [],
  subspecialty: "",
  email: "",
  bio: "",
  certificates: [],
  seeking_work: false,
  retired: false,
  workplaces: [emptyWorkplace(true)],
  consent: false,
  pledge: false,
};

// Strip disallowed chars from phone + license inputs so a paste of
// "Phone: 050-1234567" still produces a clean digit string. Arabic-Indic
// digits are converted first: an Arabic keyboard types ٠٥٠, and stripping
// them used to leave the field empty. Server-side normalization is the
// actual source of truth.
export const cleanPhone = (next: string) =>
  toAsciiDigits(next).replace(/[^0-9+\-\s()]/g, "");

// An IL license may be typed the way registries.health.gov.il prints it,
// `1-189371`, profession code + serial, so the hyphen has to survive the
// input; the server reduces both forms to the serial. Only the first
// hyphen is kept, since there is only ever one.
// PS licenses have no confirmed public format, so we only strip characters
// that would break the request.
export const cleanLicense = (region: LicenseRegion, next: string) => {
  const ascii = toAsciiDigits(next);
  if (region === "PS") return ascii.replace(/[,()]/g, "");
  const cleaned = ascii.replace(/[^\d-]/g, "");
  const cut = cleaned.indexOf("-");
  return cut === -1
    ? cleaned
    : cleaned.slice(0, cut + 1) + cleaned.slice(cut + 1).replace(/-/g, "");
};

/**
 * Everything the stage choice implies, applied in one update so the form can
 * never render a state that contradicts it: the auto-attached specialty, the
 * residency year, and any workplace whose type the new stage doesn't offer.
 */
export function applyStage(
  s: FormState,
  next: Stage,
  generalSpecialtyId: string | null,
): FormState {
  const opt = STAGE_BY_KEY[next];
  return {
    ...s,
    stage: next,
    specialty_ids: opt.autoAttachesGeneralSpecialty
      ? generalSpecialtyId
        ? [generalSpecialtyId]
        : []
      : s.specialty_ids.filter((id) => id !== generalSpecialtyId),
    subspecialty: opt.showsSpecialtyPicker ? s.subspecialty : "",
    certificates: opt.showsCertificates ? s.certificates : [],
    residency_start_year: opt.requiresResidencyStartYear
      ? s.residency_start_year
      : "",
    // A row the doctor hasn't touched yet adopts the stage's default type
    // (عيادة for طب عام); a row they've already named only gets corrected
    // when the new stage doesn't offer its type at all.
    workplaces: s.workplaces.map((w) =>
      workplaceForStage(
        w.name.trim() === ""
          ? { ...w, workplace_type: opt.defaultWorkplaceType }
          : w,
        next,
      ),
    ),
  };
}

/** The /api/signup/start request body. */
export function buildStartBody(
  form: FormState,
  overrideMismatch: boolean,
  turnstileToken: string,
) {
  return {
    ...form,
    // `stage` is a UI-only key; the column holds two values with طب عام
    // as NULL. JSON.stringify drops the undefined.
    stage: undefined,
    career_stage: form.stage ? STAGE_BY_KEY[form.stage].careerStage : null,
    residency_start_year: form.residency_start_year
      ? Number(form.residency_start_year)
      : null,
    workplaces: cleanWorkplaces(form.workplaces),
    secondary_license_region: form.has_secondary_license
      ? form.secondary_license_region
      : null,
    secondary_license_number: form.has_secondary_license
      ? form.secondary_license_number.trim()
      : null,
    override_name_mismatch: overrideMismatch,
    turnstile_token: turnstileToken,
    // Kept with the unfinished signup, so a reminder's link can reopen the
    // form as the doctor left it (lib/signup/unfinished.ts).
    resume_form: { ...form, consent: false, pledge: false },
  };
}
