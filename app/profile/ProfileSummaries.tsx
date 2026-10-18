// The read-only side of the profile form: what a section shows until the
// doctor presses تعديل.

import type { StageOption } from "@/lib/careerStage";
import type { Doctor } from "@/lib/db/types";
import {
  WORKPLACE_TYPE_LABEL,
  type WorkplaceEntry,
  workplaceInfoLine,
} from "@/lib/workplace";
import { Locked, Section } from "./ProfileFields";

const regionLabel = (r: string | null) => (r === "IL" ? "إسرائيلي" : "فلسطيني");

export function FixedInfoSection({ doctor }: { doctor: Doctor }) {
  return (
    <Section title="معلومات ثابتة">
      <p className="text-sm text-foreground/65">
        هذه المعلومات لا يمكن تعديلها ذاتيًا. للحاجة إلى تعديل، تواصل مع
        المطوّر من زر الأسفل.
      </p>
      <Locked label="رقم الهاتف">{doctor.phone_e164}</Locked>
      <Locked label="رقم الترخيص">
        {doctor.license_number}{" "}
        <span className="text-foreground/50">
          ({regionLabel(doctor.license_region)})
        </span>
      </Locked>
      {doctor.secondary_license_number && (
        <Locked label="ترخيص إضافي">
          {doctor.secondary_license_number}{" "}
          <span className="text-foreground/50">
            ({regionLabel(doctor.secondary_license_region)})
          </span>
        </Locked>
      )}
      {(doctor.hebrew_first_name || doctor.hebrew_family_name) && (
        <Locked label="الاسم بالعبرية">
          {doctor.hebrew_first_name} {doctor.hebrew_family_name}
        </Locked>
      )}
    </Section>
  );
}

function Chips({ items }: { items: { key: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((c) => (
        <li
          key={c.key}
          className="rounded-full border border-foreground/20 bg-foreground/5 px-2.5 py-0.5 text-sm"
        >
          {c.label}
        </li>
      ))}
    </ul>
  );
}

const unset = <span className="text-foreground/40">غير محدد</span>;

export function StageSummary({
  stageOpt,
  residencyStartYear,
}: {
  stageOpt: StageOption | null;
  residencyStartYear: string;
}) {
  if (!stageOpt) return unset;
  return (
    <span>
      {stageOpt.label}
      {stageOpt.requiresResidencyStartYear && residencyStartYear
        ? ` · بداية التخصص ${residencyStartYear}`
        : ""}
    </span>
  );
}

export function SpecialtiesSummary({
  specialties,
  specialtyIds,
  showSubspecialty,
  subspecialty,
  showCertificates,
  certificates,
  bio,
}: {
  specialties: { id: string; name_ar: string }[];
  specialtyIds: string[];
  showSubspecialty: boolean;
  subspecialty: string;
  showCertificates: boolean;
  certificates: string[];
  bio: string;
}) {
  const filledCertificates = certificates.filter((c) => c.trim());
  return (
    <>
      <div>
        <div className="mb-1 text-sm text-foreground/65">التخصصات</div>
        {specialtyIds.length === 0 ? (
          <span className="text-foreground/40">لا يوجد</span>
        ) : (
          <Chips
            items={specialties
              .filter((s) => specialtyIds.includes(s.id))
              .map((s) => ({ key: s.id, label: s.name_ar }))}
          />
        )}
      </div>
      {showSubspecialty && (
        <div>
          <div className="mb-1 text-sm text-foreground/65">
            التخصص الفرعي
          </div>
          <span>{subspecialty || unset}</span>
        </div>
      )}
      {showCertificates && (
        <div>
          <div className="mb-1 text-sm text-foreground/65">شهادات إضافية</div>
          {filledCertificates.length === 0 ? (
            <span className="text-foreground/40">لا يوجد</span>
          ) : (
            <Chips items={filledCertificates.map((c) => ({ key: c, label: c }))} />
          )}
        </div>
      )}
      <div>
        <div className="mb-1 text-sm text-foreground/65">نبذة عني</div>
        <span className="whitespace-pre-line">{bio || unset}</span>
      </div>
    </>
  );
}

export function WorkplacesSummary({ workplaces }: { workplaces: WorkplaceEntry[] }) {
  const named = workplaces.filter((w) => w.name.trim().length > 0);
  if (named.length === 0) {
    return <span className="text-foreground/40">لا يوجد</span>;
  }
  return (
    <ul className="space-y-1">
      {named.map((w, i) => (
        <li key={i} className="flex flex-wrap items-center gap-2">
          {w.is_primary && (
            <span className="rounded-full border border-foreground/20 bg-foreground/5 px-2 py-0.5 text-xs">
              رئيسي
            </span>
          )}
          <span className="rounded-full border border-foreground/15 px-2 py-0.5 text-xs text-foreground/65">
            {WORKPLACE_TYPE_LABEL[w.workplace_type]}
          </span>
          <span>{w.name}</span>
          {workplaceInfoLine(w) && (
            <span className="text-foreground/60">({workplaceInfoLine(w)})</span>
          )}
        </li>
      ))}
    </ul>
  );
}
