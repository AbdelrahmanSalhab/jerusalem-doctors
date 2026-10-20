import { Avatar } from "@/components/Avatar";
import { ContactButtons } from "@/components/ContactButtons";
import { clinicTelHref } from "@/lib/workplace";
import { cardChips, cardServices, RETIRED_LABEL, SEEKING_WORK_LABEL, type SearchHit } from "@/lib/directory";
import { careerStageBadge } from "@/lib/careerStage";
import { WorkplaceDetails } from "@/components/WorkplaceDetails";



export function DoctorCard({ doctor }: { doctor: SearchHit }) {
  const name = `${doctor.arabic_first_name} ${doctor.arabic_family_name}`;
  const chips = cardChips(doctor);
  const services = cardServices(doctor);
  const primaryWp = doctor.workplaces.find((w) => w.is_primary);
  const otherWps = doctor.workplaces.filter((w) => !w.is_primary);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-sm">
      <header className="flex items-center gap-3">
        <Avatar
          url={doctor.profile_picture_url}
          fallback={doctor.arabic_first_name}
          size="lg"
          alt={name}
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold leading-tight">{name}</h3>
          {(chips.length > 0 ||
            doctor.seeking_work ||
            doctor.retired ||
            doctor.career_stage) && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {chips.map((s) => (
                <li
                  key={s}
                  className="rounded-full border border-foreground/20 bg-foreground/5 px-2 py-0.5 text-xs"
                >
                  {s}
                </li>
              ))}
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
              {doctor.retired && (
                <li className="rounded-full border border-foreground/20 bg-foreground/5 px-2 py-0.5 text-xs text-muted">
                  {RETIRED_LABEL}
                </li>
              )}
            </ul>
          )}
        </div>
      </header>

      {doctor.bio && (
        <p className="whitespace-pre-line text-sm text-foreground/80">
          {doctor.bio}
        </p>
      )}

      {services.length > 0 && (
        <p className="text-sm">
          <span className="text-foreground/65">الخدمات:</span> {services.join("، ")}
        </p>
      )}

      {doctor.subspecialty && (
        <p className="text-sm">
          <span className="text-foreground/65">التخصص الفرعي:</span>{" "}
          {doctor.subspecialty}
        </p>
      )}

      {primaryWp && (
        <div className="text-sm">
          <p>
            <span className="text-foreground/65">
              {primaryWp.workplace_type === "clinic" ? "العيادة:" : "مكان العمل:"}
            </span>{" "}
            <span className="font-medium">{primaryWp.name}</span>
          </p>
          <WorkplaceDetails w={primaryWp} />
          {otherWps.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-foreground/75">
              {otherWps.map((w) => (
                <li key={w.name}>
                  {w.name}
                  <WorkplaceDetails w={w} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <dl className="flex flex-col gap-1 text-sm">
        {doctor.phone_display && (
          <div className="flex items-baseline gap-2">
            <dt className="text-foreground/65">الهاتف:</dt>
            <dd dir="ltr">
              <a href={clinicTelHref(doctor.phone_display) ?? undefined} className="hover:underline">
                {doctor.phone_display}
              </a>
            </dd>
          </div>
        )}
        {doctor.email && (
          <div className="flex items-baseline gap-2">
            <dt className="text-foreground/65">البريد:</dt>
            <dd dir="ltr" className="break-all">
              {doctor.email}
            </dd>
          </div>
        )}
      </dl>

      <ContactButtons doctor={doctor} />
    </article>
  );
}
