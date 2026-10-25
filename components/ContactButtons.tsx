"use client";

// Call, WhatsApp and "add to contacts" on a doctor's card or row. The
// WhatsApp message opens with who is writing (lib/contactIntro.ts); the
// contact file puts the colleague's name on future calls (lib/vcard.ts).

import { useViewer } from "@/components/ViewerContext";
import { whatsappHref, whatsappIntro } from "@/lib/contactIntro";
import type { SearchHit } from "@/lib/directory";
import { doctorVCard, vcardFileName } from "@/lib/vcard";
import { clinicTelHref } from "@/lib/workplace";

type ContactDoctor = Pick<
  SearchHit,
  | "id"
  | "arabic_first_name"
  | "arabic_family_name"
  | "phone_display"
  | "phone_e164"
  | "whatsapp_url"
  | "email"
  | "specialties"
  | "workplaces"
>;

/** Counts the press for the stats page (0017). A beacon survives the page
 *  handing off to WhatsApp or the dialer, and never delays it. */
function track(target: string, channel: "call" | "whatsapp" | "save") {
  try {
    navigator.sendBeacon?.("/api/usage/contact", JSON.stringify({ target, channel }));
  } catch {
    // counting is best effort
  }
}

function saveContact(d: ContactDoctor) {
  track(d.id, "save");
  const url = URL.createObjectURL(new Blob([doctorVCard(d)], { type: "text/vcard;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = vcardFileName(d);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ContactButtons({ doctor, compact = false }: { doctor: ContactDoctor; compact?: boolean }) {
  const viewer = useViewer();
  const tel = clinicTelHref(doctor.phone_display);
  const wa = doctor.whatsapp_url
    ? whatsappHref(doctor.whatsapp_url, whatsappIntro(viewer, doctor.arabic_first_name))
    : null;
  if (!tel && !wa) return null;
  const size = compact ? "px-3 py-2 text-sm" : "px-4 py-2.5";
  return (
    <div className={compact ? "flex shrink-0 flex-wrap gap-2" : "mt-1 flex flex-col gap-2"}>
      <div className={compact ? "flex gap-2" : "grid grid-cols-2 gap-2"}>
        {tel && (
          <a
            href={tel}
            onClick={() => track(doctor.id, "call")}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-surface font-medium hover:bg-foreground/5 ${size}`}
          >
            <span aria-hidden="true">☎</span> اتصال
          </a>
        )}
        {wa && (
          <a
            href={wa}
            onClick={() => track(doctor.id, "whatsapp")}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center justify-center rounded-md bg-[#1fa855] font-medium text-white hover:opacity-90 ${size} ${tel ? "" : "col-span-2"}`}
          >
            واتساب
          </a>
        )}
      </div>
      {doctor.phone_e164 && (
        <button
          type="button"
          onClick={() => saveContact(doctor)}
          className={`inline-flex items-center text-sm text-muted underline-offset-2 hover:text-foreground hover:underline pointer-coarse:min-h-11 ${compact ? "px-1" : "self-center"}`}
        >
          + إضافة لجهات الاتصال
        </button>
      )}
    </div>
  );
}
