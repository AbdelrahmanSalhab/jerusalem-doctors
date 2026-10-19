import { Avatar } from "@/components/Avatar";
import { cardChips, SEEKING_WORK_LABEL, type SearchHit } from "@/lib/directory";
import { careerStageBadge } from "@/lib/careerStage";
import { workplaceInfoLine, clinicTelHref } from "@/lib/workplace";

const WHATSAPP_LABEL = "تواصل عبر واتساب";

/**
 * Compact dashboard search row. Shows the same data as DoctorCard, just in
 * a denser horizontal layout, the two views must never disagree about
 * what's visible for a given doctor (otherwise users think info is hidden
 * when it isn't).
 */
export function DoctorRow({ doctor }: { doctor: SearchHit }) {
  const name = `${doctor.arabic_first_name} ${doctor.arabic_family_name}`;
  const chips = cardChips(doctor);
  const primaryWp = doctor.workplaces.find((w) => w.is_primary);
  const otherWps = doctor.workplaces.filter((w) => !w.is_primary);

  return (
    <article className="group flex flex-col gap-3 border-b border-foreground/10 px-2 py-4 transition-colors last:border-b-0 hover:bg-foreground/[0.03] sm:flex-row sm:items-start sm:gap-4 sm:px-3">
      <Avatar
        url={doctor.profile_picture_url}
        fallback={doctor.arabic_first_name}
        size="md"
        alt={name}
      />

      <div className="min-w-0 flex-1 space-y-1.5">
        <h3 className="text-lg font-bold leading-tight">{name}</h3>

        {(chips.length > 0 || doctor.seeking_work ||
          doctor.subspecialty ||
          doctor.career_stage) && (
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((s) => (
              <li
                key={s}
                className="rounded-full border border-foreground/15 bg-foreground/5 px-2 py-0.5 text-xs"
              >
                {s}
              </li>
            ))}
            {doctor.subspecialty && (
              <li className="rounded-full border border-warn-line bg-warn-bg px-2 py-0.5 text-xs text-warn">
                {doctor.subspecialty}
              </li>
            )}
            {doctor.career_stage && (
              <li className="rounded-full border border-info-line bg-info-bg px-2 py-0.5 text-xs text-info">
                {careerStageBadge(doctor.career_stage, doctor.residency_start_year)}
              </li>
            )}
            {doctor.seeking_work && (
              <li className="rounded-full border border-success-line bg-success-bg px-2 py-0.5 text-xs text-success">
                {SEEKING_WORK_LABEL}
              </li>
            )}
          </ul>
        )}

        {doctor.bio && (
          <p className="whitespace-pre-line text-sm text-foreground/80">
            {doctor.bio}
          </p>
        )}

        {primaryWp && (
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm text-foreground/75">
            <span aria-hidden="true">📍</span>
            <span className="font-medium text-foreground">{primaryWp.name}</span>
            {workplaceInfoLine(primaryWp) && (
              <span className="text-foreground/60">({workplaceInfoLine(primaryWp)})</span>
            )}
            {otherWps.length > 0 && (
              <span className="text-foreground/65">
                · {otherWps.map((w) => w.name).join("، ")}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-foreground/65">
          {doctor.phone_display && (
            <a
              href={clinicTelHref(doctor.phone_display) ?? undefined}
              className="inline-flex items-center gap-1 hover:underline"
              dir="ltr"
            >
              <span aria-hidden="true">📞</span>
              {doctor.phone_display}
            </a>
          )}
          {doctor.email && (
            <span
              className="inline-flex items-center gap-1 break-all"
              dir="ltr"
            >
              <span aria-hidden="true">✉️</span>
              {doctor.email}
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
