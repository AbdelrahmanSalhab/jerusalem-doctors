// What still blocks the signup form, in page order. One source for both the
// "complete these fields" list shown above the submit button and the
// button's disabled state, so the two can never disagree. Each key is the
// DOM id of the input it points at; the list focuses it on click.

import { isValidResidencyYear, STAGE_BY_KEY, type Stage } from "@/lib/careerStage";
import {
  CLINIC_FIELD_LABEL,
  hasInvalidClinicPhone,
  type WorkplaceType,
} from "@/lib/workplace";

type Region = "IL" | "PS";

/** The slice of the signup form state this check reads. */
export interface SignupFields {
  phone: string;
  license_region: Region;
  license_number: string;
  has_secondary_license: boolean;
  secondary_license_region: Region;
  secondary_license_number: string;
  arabic_first_name: string;
  arabic_family_name: string;
  hebrew_first_name: string;
  hebrew_family_name: string;
  stage: Stage | null;
  residency_start_year: string;
  specialty_ids: readonly string[];
  email: string;
  seeking_work: boolean;
  retired: boolean;
  workplaces: readonly {
    name: string;
    workplace_type: WorkplaceType;
    address: string;
    phone: string;
  }[];
  consent: boolean;
  pledge: boolean;
}

export interface MissingField {
  key: string;
  label: string;
}

export function needsHebrewName(f: SignupFields): boolean {
  return (
    f.license_region === "IL" ||
    (f.has_secondary_license && f.secondary_license_region === "IL")
  );
}

const blank = (v: string) => v.trim() === "";

export function getMissingFields(f: SignupFields): MissingField[] {
  const missing: MissingField[] = [];
  const need = (when: boolean, key: string, label: string) => {
    if (when) missing.push({ key, label });
  };

  need(blank(f.phone), "phone", "رقم الهاتف");
  need(blank(f.license_number), "license_number", "رقم الترخيص");
  need(
    f.has_secondary_license && blank(f.secondary_license_number),
    "secondary_license_number",
    "رقم الترخيص الإضافي",
  );
  need(blank(f.email), "email", "البريد الإلكتروني");
  need(blank(f.arabic_first_name), "arabic_first_name", "الاسم بالعربية");
  need(blank(f.arabic_family_name), "arabic_family_name", "اسم العائلة بالعربية");
  if (needsHebrewName(f)) {
    need(blank(f.hebrew_first_name), "hebrew_first_name", "الاسم بالعبرية");
    need(blank(f.hebrew_family_name), "hebrew_family_name", "اسم العائلة بالعبرية");
  }
  need(f.stage === null, "stage", "المرحلة المهنية");

  if (f.stage !== null) {
    const opt = STAGE_BY_KEY[f.stage];
    need(
      opt.requiresResidencyStartYear && !isValidResidencyYear(f.residency_start_year),
      "residency_start_year",
      "سنة بداية التخصص",
    );
    need(f.specialty_ids.length === 0, "specialty_ids", "التخصص");
    need(
      !opt.workplaceOptional &&
        !f.seeking_work &&
        !f.retired &&
        !f.workplaces.some((w) => !blank(w.name)),
      "workplace_0_name",
      "مكان العمل",
    );
    // Clinic address and phone are optional so a doctor can sign up on the
    // spot; only a phone typed wrong is flagged, as the server rejects it.
    f.workplaces.forEach((w, i) => {
      if (hasInvalidClinicPhone(w)) {
        missing.push({
          key: `workplace_${i}_phone`,
          label: `${CLINIC_FIELD_LABEL.phone} (${w.name.trim()})`,
        });
      }
    });
  }

  need(!f.consent, "consent", "الموافقة على استخدام المعلومات");
  need(!f.pledge, "pledge", "الالتزام بعدم مشاركة أرقام الزملاء");
  return missing;
}
