// The profile form's pre-save checks, in the order the doctor sees them.
// /api/profile validates again; these only give a readable message first.

import { isValidResidencyYear, type StageOption } from "@/lib/careerStage";
import {
  cleanWorkplaces,
  hasInvalidClinicPhone,
  missingClinicFields,
  type WorkplaceEntry,
} from "@/lib/workplace";

export interface ProfileCheck {
  message: string;
  /** The message is about a workplace row, so that section must be open. */
  openWorkplaces?: boolean;
}

export function profileFormError(f: {
  stageOpt: StageOption | null;
  workplaces: readonly WorkplaceEntry[];
  specialtyIds: readonly string[];
  residencyStartYear: string;
}): ProfileCheck | null {
  const cleaned = cleanWorkplaces(f.workplaces);
  if (cleaned.length === 0 && !f.stageOpt?.workplaceOptional) {
    return { message: "الرجاء إدخال مكان عمل واحد على الأقل." };
  }
  if (f.workplaces.some(hasInvalidClinicPhone)) {
    return { message: "رقم هاتف العيادة غير صالح.", openWorkplaces: true };
  }
  const primaryCount = cleaned.filter((w) => w.is_primary).length;
  if (cleaned.length > 0 && primaryCount !== 1) {
    return { message: "اختر مكان عمل رئيسي واحد فقط." };
  }
  if (f.specialtyIds.length === 0) {
    return { message: "اختر تخصصًا واحدًا على الأقل." };
  }
  if (
    f.stageOpt?.requiresResidencyStartYear &&
    !isValidResidencyYear(f.residencyStartYear)
  ) {
    return { message: "أدخل سنة بداية التخصص." };
  }
  return null;
}

/** Names of the clinics still missing an address or phone. Saving doesn't
 *  need them (a doctor can sign up on the spot); the profile reminds. */
export function clinicsMissingDetails(
  stageOpt: StageOption | null,
  workplaces: readonly WorkplaceEntry[],
): string[] {
  if (!stageOpt?.showsClinicFields) return [];
  return workplaces
    .filter((w) => missingClinicFields(w).length > 0)
    .map((w) => w.name.trim());
}
