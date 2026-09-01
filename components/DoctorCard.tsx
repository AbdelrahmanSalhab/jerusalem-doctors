import { Avatar } from "@/components/Avatar";
import type { SearchHit } from "@/app/api/search/route";
import { CAREER_STAGE_LABEL } from "@/lib/careerStage";

const WHATSAPP_LABEL = "تواصل عبر واتساب";

export function DoctorCard({ doctor }: { doctor: SearchHit }) {
  const name = `${doctor.arabic_first_name} ${doctor.arabic_family_name}`;
  const primaryWp = doctor.workplaces.find((w) => w.is_primary);
  const otherWps = doctor.workplaces.filter((w) => !w.is_primary);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-foreground/15 bg-background p-5 shadow-sm">
      <header className="flex items-center gap-3">
        <Avatar
          url={doctor.profile_picture_url}
          fallback={doctor.arabic_first_name}
          size="lg"
          alt={name}
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold leading-tight">{name}</h3>
          {(doctor.specialties.length > 0 || doctor.career_stage) && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {doctor.specialties.map((s) => (
                <li
                  key={s}
                  className="rounded-full border border-foreground/20 bg-foreground/5 px-2 py-0.5 text-xs"
                >
                  {s}
                </li>
              ))}
              {doctor.career_stage && (
                <li className="rounded-full border border-sky-300/60 bg-sky-50/60 px-2 py-0.5 text-xs text-sky-900 dark:bg-sky-900/20 dark:text-sky-100">
                  {CAREER_STAGE_LABEL[doctor.career_stage]}
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
          {primaryWp.details && (
            <p className="mt-0.5 text-foreground/65">{primaryWp.details}</p>
          )}
          {otherWps.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-foreground/75">
              {otherWps.map((w) => (
                <li key={w.name}>
                  {w.name}
                  {w.details ? ` — ${w.details}` : ""}
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
            <dd dir="ltr">{doctor.phone_display}</dd>
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

      {doctor.whatsapp_url && (
        <a
          href={doctor.whatsapp_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center justify-center rounded-md bg-[#25d366] px-4 py-2.5 font-medium text-white hover:opacity-90"
        >
          {WHATSAPP_LABEL}
        </a>
      )}
    </article>
  );
}
