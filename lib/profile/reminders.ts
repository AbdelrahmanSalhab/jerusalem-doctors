// What a doctor's own profile still lacks, for the dashboard's "complete your
// profile" note. Only things that make the card more useful to colleagues.

import { missingClinicFields } from "@/lib/workplace";

interface ReminderDoctor {
  career_stage: "resident" | "specialist" | null;
  profile_picture_url: string | null;
  certificates?: string[] | null;
  retired?: boolean | null;
}

interface ReminderWorkplace {
  name: string;
  /** The stored column (text, checked in SQL). */
  workplace_type: string;
  address: string | null;
  phone: string | null;
}

export function profileGaps(doctor: ReminderDoctor, workplaces: ReminderWorkplace[]): string[] {
  const gaps: string[] = [];
  // Residents rotate and have no clinic fields (see STAGE_OPTIONS); a retired
  // doctor has no workplace to add, so nagging them about one never clears.
  if (doctor.career_stage !== "resident" && !doctor.retired) {
    if (workplaces.length === 0) gaps.push("أضف مكان عملك ليعرف الزملاء أين يجدونك.");
    for (const w of workplaces) {
      const missing = missingClinicFields({
        name: w.name,
        workplace_type: w.workplace_type,
        address: w.address ?? "",
        phone: w.phone ?? "",
      });
      if (missing.length === 0) continue;
      const what = missing.length === 2 ? "العنوان والهاتف" : missing[0] === "address" ? "العنوان" : "الهاتف";
      gaps.push(`أضف ${what} لعيادة «${w.name}» ليتمكّن الزملاء من الوصول إليها والاتصال بها.`);
    }
  }
  if (!doctor.profile_picture_url) gaps.push("أضف صورة شخصية ليتعرّف عليك الزملاء.");
  if (!doctor.certificates?.length) {
    gaps.push("أضف الخدمات والإجراءات التي تقدّمها، ليجدك الزملاء حين يبحثون عنها.");
  }
  return gaps;
}
