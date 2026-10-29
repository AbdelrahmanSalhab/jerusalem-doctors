// What a doctor's own profile still lacks, for the dashboard's "complete your
// profile" note. Only things that make the card more useful to colleagues.

import { missingClinicFields, type WorkplaceType } from "@/lib/workplace";

interface ReminderDoctor {
  career_stage: "resident" | "specialist" | null;
  profile_picture_url: string | null;
  certificates?: string[] | null;
  retired?: boolean | null;
}

interface ReminderWorkplace {
  name: string;
  workplace_type: WorkplaceType;
  address: string | null;
  phone: string | null;
}

function whatIsMissing(missing: ("address" | "phone")[]): string {
  return missing.length === 2 ? "العنوان والهاتف" : missing[0] === "address" ? "العنوان" : "الهاتف";
}

export function profileGaps(doctor: ReminderDoctor, workplaces: ReminderWorkplace[]): string[] {
  const gaps: string[] = [];
  // Residents rotate and have no clinic fields (see STAGE_OPTIONS); a retired
  // doctor has no workplace to add, so nagging them about one never clears.
  if (doctor.career_stage !== "resident" && !doctor.retired) {
    if (workplaces.length === 0) gaps.push("أضف مكان عملك ليعرف الزملاء أين يجدونك.");
    const lacking = workplaces.flatMap((w) => {
      const missing = missingClinicFields({
        name: w.name,
        workplace_type: w.workplace_type,
        address: w.address ?? "",
        phone: w.phone ?? "",
      });
      return missing.length ? [{ name: w.name, missing }] : [];
    });
    // Several clinics get one line, not one each: a doctor in three clinics
    // should not be asked three times for the same thing.
    if (lacking.length === 1) {
      const { name, missing } = lacking[0];
      gaps.push(`يمكنك إضافة ${whatIsMissing(missing)} لعيادة «${name}» ليتمكّن الزملاء من الوصول إليها.`);
    } else if (lacking.length > 1) {
      const all = [...new Set(lacking.flatMap((l) => l.missing))];
      gaps.push(`يمكنك إضافة ${whatIsMissing(all)} لعياداتك ليتمكّن الزملاء من الوصول إليها.`);
    }
  }
  if (!doctor.profile_picture_url) gaps.push("أضف صورة شخصية ليتعرّف عليك الزملاء.");
  if (!doctor.certificates?.length) {
    gaps.push("أضف الخدمات والإجراءات التي تقدّمها، ليجدك الزملاء حين يبحثون عنها.");
  }
  return gaps;
}

/** The reminder stays closed while its list of gaps is the one it was closed
 *  on, and comes back only when something new is missing. */
export function gapsKey(gaps: string[]): string {
  return gaps.join("\n");
}
