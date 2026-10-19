// Everything known about one doctor, server-rendered.
//
// An admin deciding whether to let someone in used to see less about them
// than any logged-in colleague sees on their card. This is the whole record:
// who they are, why their licence came out the way it did, where they work,
// how to reach them, and what has been done to the account.

import { Avatar } from "@/components/Avatar";
import { DoctorPanelControls } from "./DoctorPanelControls";
import { LicenseSection } from "./LicenseSection";
import { auditDetail, auditTime, auditTitle } from "@/lib/auditText";
import { careerStageBadge } from "@/lib/careerStage";
import { FEATURED_LABEL } from "@/lib/directory";
import type { DoctorDetail } from "@/lib/admin/doctorDetail";
import { mapLinks, WORKPLACE_TYPE_LABEL, type WorkplaceType } from "@/lib/workplace";

/** "19/10/2026 14:53" in Jerusalem time, or a dash. */
function when(iso: string | null): string {
  return iso ? auditTime(iso) : "—";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Rows({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="flex flex-col gap-1.5 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[9rem_1fr] gap-2">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const yesNo = (v: boolean) => (v ? "نعم" : "لا");

export function DoctorPanelBody({ detail, closeHref }: { detail: DoctorDetail; closeHref: string }) {
  const d = detail.doctor;
  const stage = d.career_stage ? careerStageBadge(d.career_stage, d.residency_start_year) : "طب عام";
  const hebrew = [d.hebrew_first_name, d.hebrew_family_name].filter(Boolean).join(" ");

  return (
    <>
      <header className="flex items-start gap-4">
        <Avatar url={d.profile_picture_url} fallback={d.arabic_first_name} size="xl" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-lg font-semibold">
            د. {d.arabic_first_name} {d.arabic_family_name}
          </p>
          {hebrew && (
            <p dir="ltr" className="text-sm text-muted">
              {hebrew}
            </p>
          )}
          <p className="flex flex-wrap gap-2 text-sm text-muted">
            {stage && <span>{stage}</span>}
            {d.featured && <span>· {FEATURED_LABEL[d.featured]}</span>}
            {d.is_admin && <span>· حساب إدارة</span>}
          </p>
        </div>
      </header>

      <DoctorPanelControls
        doctor={{
          id: d.id,
          arabic_first_name: d.arabic_first_name,
          arabic_family_name: d.arabic_family_name,
          license_verification_status: d.license_verification_status,
          license_region: d.license_region,
          career_stage: d.career_stage,
          residency_start_year: d.residency_start_year,
          featured: d.featured,
          seeking_work: d.seeking_work,
          is_admin_approved: d.is_admin_approved,
          is_active: d.is_active,
          is_visible: d.is_visible,
          is_phone_verified: d.is_phone_verified,
          consent_directory_use: d.consent_directory_use,
        }}
        closeHref={closeHref}
      />

      <Section title="التحقق من الترخيص">
        <div className="flex flex-col gap-4">
          {detail.licenses.map((slot) => (
            <LicenseSection key={slot.slot} doctorId={d.id} slot={slot} />
          ))}
        </div>
      </Section>

      <Section title="المعلومات المهنية">
        <Rows
          items={[
            ["التخصصات", detail.specialties.length > 0 ? detail.specialties.join("، ") : "لا شيء"],
            ["تخصص دقيق", d.subspecialty || "لا شيء"],
            ["شهادات وخدمات", d.certificates?.length ? d.certificates.join("، ") : "لا شيء"],
            ["نبذة", d.bio || "لا شيء"],
            ["يبحث عن فرصة عمل", yesNo(d.seeking_work)],
          ]}
        />
      </Section>

      <Section title="أماكن العمل">
        {detail.workplaces.length === 0 ? (
          <p className="text-sm text-muted">لم يضف أي مكان عمل.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.workplaces.map((w, i) => {
              const links = mapLinks(w.address);
              return (
                <li key={`${w.name}-${i}`} className="flex flex-col gap-0.5 text-sm">
                  <span className="font-medium">
                    {w.name}
                    {w.is_primary && <span className="ms-2 text-xs text-muted">(الأساسي)</span>}
                  </span>
                  <span className="text-muted">
                    {WORKPLACE_TYPE_LABEL[w.workplace_type as WorkplaceType] ?? w.workplace_type}
                    {w.details && ` · ${w.details}`}
                  </span>
                  {w.address && (
                    <span className="text-muted">
                      {w.address}
                      {links && (
                        <>
                          {" · "}
                          <a href={links.google} target="_blank" rel="noopener noreferrer" className="underline">
                            خريطة
                          </a>
                        </>
                      )}
                    </span>
                  )}
                  {w.hours && <span className="text-muted">{w.hours}</span>}
                  {w.phone && (
                    <span dir="ltr" className="text-muted">
                      {w.phone}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="التواصل">
        <Rows
          items={[
            ["الهاتف", <span key="phone" dir="ltr">{d.phone_display || d.phone_e164}</span>],
            ["الهاتف الدولي", <span key="e164" dir="ltr">{d.phone_e164}</span>],
            ["البريد", d.email ? <span key="email" dir="ltr">{d.email}</span> : "لا شيء"],
            ["الهاتف موثّق", yesNo(d.is_phone_verified)],
            ["وافق على الظهور في الدليل", `${yesNo(d.consent_directory_use)} (${when(d.consent_timestamp)})`],
          ]}
        />
      </Section>

      <Section title="النشاط">
        <Rows
          items={[
            ["تاريخ الانضمام", when(d.created_at)],
            ["آخر تعديل", when(d.updated_at)],
            ["آخر دخول", detail.lastSignInAt ? when(detail.lastSignInAt) : "لم يسجّل دخولًا بعد"],
            ["رقم الحساب", <span key="id" dir="ltr">{d.id}</span>],
          ]}
        />
      </Section>

      <Section title="آخر الأحداث">
        {detail.audit.length === 0 ? (
          <p className="text-sm text-muted">لا أحداث مسجَّلة.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.audit.map((row) => {
              const line = auditDetail(row, () => undefined);
              return (
                <li key={row.id} className="flex flex-col">
                  <span className="font-medium">
                    {auditTitle(row.action)} <span className="text-xs text-muted">{auditTime(row.created_at)}</span>
                  </span>
                  {line && <span className="text-muted">{line}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <a href="/admin/audit" className="w-fit text-sm underline">
          سجل النشاط الكامل
        </a>
      </Section>
    </>
  );
}
