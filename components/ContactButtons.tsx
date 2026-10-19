// Call and WhatsApp, side by side, on a doctor's card or row. The phone
// number above was already a call link, but nothing made that obvious.

import type { SearchHit } from "@/lib/directory";
import { clinicTelHref } from "@/lib/workplace";

export function ContactButtons({
  doctor,
  compact = false,
}: {
  doctor: Pick<SearchHit, "phone_display" | "whatsapp_url">;
  compact?: boolean;
}) {
  const tel = clinicTelHref(doctor.phone_display);
  if (!tel && !doctor.whatsapp_url) return null;
  const size = compact ? "px-3 py-2 text-sm" : "px-4 py-2.5";
  return (
    <div className={compact ? "flex shrink-0 gap-2" : "mt-1 grid grid-cols-2 gap-2"}>
      {tel && (
        <a
          href={tel}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-surface font-medium hover:bg-foreground/5 ${size}`}
        >
          <span aria-hidden="true">☎</span> اتصال
        </a>
      )}
      {doctor.whatsapp_url && (
        <a
          href={doctor.whatsapp_url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center justify-center rounded-md bg-[#1fa855] font-medium text-white hover:opacity-90 ${size} ${tel ? "" : "col-span-2"}`}
        >
          واتساب
        </a>
      )}
    </div>
  );
}
