// What a doctor's WhatsApp message to a colleague opens with. The colleague
// usually doesn't have the sender's number saved, so the message says who is
// writing instead of only "I found your number in the directory".

import { DEFAULT_WHATSAPP_PREFILLED } from "@/lib/whatsapp";

export interface Viewer {
  firstName: string;
  familyName: string;
  /** e.g. "الباطنية" or "طب عام"; omitted when unknown. */
  specialty?: string | null;
  /** The viewer's main workplace, if any. */
  workplace?: string | null;
}

export function whatsappIntro(viewer: Viewer | null, colleagueFirstName: string): string {
  if (!viewer) return DEFAULT_WHATSAPP_PREFILLED;
  const who = [`د. ${viewer.firstName} ${viewer.familyName}`, viewer.specialty, viewer.workplace]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join("، ");
  return `السلام عليكم د. ${colleagueFirstName}، معك ${who}. وصلت إلى رقمك من خلال دليل أطباء القدس.`;
}

/** wa.me link with the introduction filled in. */
export function whatsappHref(baseUrl: string, text: string): string {
  return `${baseUrl}?text=${encodeURIComponent(text)}`;
}
