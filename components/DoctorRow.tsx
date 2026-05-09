import { Avatar } from "@/components/Avatar";
import type { SearchHit } from "@/app/api/search/route";

const WHATSAPP_LABEL = "تواصل عبر واتساب";

/**
 * Compact dashboard search row — denser than the card but still gives each
 * doctor visual hierarchy: avatar, bold name, specialty chips, subtle
 * metadata, primary CTA on the side.
 */
export function DoctorRow({ doctor }: { doctor: SearchHit }) {
  const name = `${doctor.arabic_first_name} ${doctor.arabic_family_name}`;
  const primaryWp = doctor.workplaces.find((w) => w.is_primary);

  return (
    <article className="group flex flex-col gap-3 border-b border-foreground/10 px-2 py-4 transition-colors last:border-b-0 hover:bg-foreground/[0.03] sm:flex-row sm:items-center sm:gap-4 sm:px-3">
      <Avatar
        url={doctor.profile_picture_url}
        fallback={doctor.arabic_first_name}
        size="md"
        alt={name}
      />

      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-bold leading-tight">{name}</h3>

        {doctor.specialties.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {doctor.specialties.map((s) => (
              <li
                key={s}
                className="rounded-full border border-foreground/15 bg-foreground/5 px-2 py-0.5 text-xs"
              >
                {s}
              </li>
            ))}
            {doctor.subspecialty && (
              <li className="rounded-full border border-amber-300/60 bg-amber-50/60 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
                {doctor.subspecialty}
              </li>
            )}
          </ul>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-foreground/65">
          {primaryWp && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true">📍</span>
              {primaryWp.name}
            </span>
          )}
          {doctor.phone_display && (
            <span className="inline-flex items-center gap-1" dir="ltr">
              <span aria-hidden="true">📞</span>
              {doctor.phone_display}
            </span>
          )}
        </div>
      </div>

      {doctor.whatsapp_url && (
        <a
          href={doctor.whatsapp_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-[#25d366] px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 sm:py-2.5 sm:text-base"
        >
          {WHATSAPP_LABEL}
        </a>
      )}
    </article>
  );
}
