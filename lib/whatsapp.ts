// WhatsApp click-to-chat link builder (spec §15, plan §3 — WhatsApp interaction).
// Always render via this function so we can change formatting in one place.

const DEFAULT_PREFILLED =
  "السلام عليكم دكتور/ة، وصلت إلى رقمك من خلال دليل أطباء القدس.";

/**
 * Build a `https://wa.me/<phone>?text=<msg>` link from an E.164 phone number.
 * Accepts any string with or without a leading `+`; always strips it.
 *
 * Pass `prefilledText = ""` (empty string) to omit the prefilled message.
 * Pass nothing / undefined to use the default Arabic greeting.
 */
export function buildWhatsAppLink(
  e164: string,
  prefilledText: string | undefined = DEFAULT_PREFILLED,
): string {
  const phone = e164.replace(/^\+/, "");
  if (!phone) {
    throw new Error("buildWhatsAppLink: phone number is empty");
  }

  const base = `https://wa.me/${phone}`;
  if (!prefilledText) return base;
  return `${base}?text=${encodeURIComponent(prefilledText)}`;
}

export const DEFAULT_WHATSAPP_PREFILLED = DEFAULT_PREFILLED;
