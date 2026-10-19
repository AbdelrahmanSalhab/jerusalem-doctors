// A contact file (vCard 3.0) for "add to contacts": opening it on a phone
// offers to save the colleague, so their name shows on future calls and
// messages instead of an unknown number.

import type { SearchHit } from "@/lib/directory";

/** vCard text values escape backslash, comma, semicolon and newlines. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

export function doctorVCard(
  d: Pick<
    SearchHit,
    | "arabic_first_name"
    | "arabic_family_name"
    | "phone_e164"
    | "email"
    | "specialties"
    | "workplaces"
  >,
): string {
  const primary = d.workplaces.find((w) => w.is_primary) ?? d.workplaces[0];
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N;CHARSET=UTF-8:${esc(d.arabic_family_name)};${esc(d.arabic_first_name)};;د.;`,
    `FN;CHARSET=UTF-8:${esc(`د. ${d.arabic_first_name} ${d.arabic_family_name}`)}`,
    d.phone_e164 && `TEL;TYPE=CELL:${d.phone_e164}`,
    ...d.workplaces
      .filter((w) => w.phone?.trim())
      .map((w) => `TEL;TYPE=WORK:${w.phone!.trim()}`),
    d.email && `EMAIL:${esc(d.email)}`,
    primary && `ORG;CHARSET=UTF-8:${esc(primary.name)}`,
    d.specialties.length > 0 && `TITLE;CHARSET=UTF-8:${esc(d.specialties.join("، "))}`,
    "NOTE;CHARSET=UTF-8:دليل أطباء القدس",
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\r\n") + "\r\n";
}

/** A file name the phone shows when saving. */
export function vcardFileName(d: Pick<SearchHit, "arabic_first_name" | "arabic_family_name">): string {
  return `${d.arabic_first_name} ${d.arabic_family_name}.vcf`;
}
