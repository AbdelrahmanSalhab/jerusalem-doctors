// The doctor panel, wherever it is opened from.
//
// /admin and /admin/institutions both host it off `?doctor=`, and both must
// offer the same thing, editor included — so the two modes live here once
// rather than in each page. The reads stay in the pages, in the Promise.all
// they already run, which keeps every admin page's "requireAdmin before any
// data" shape intact and the panel plain enough to render in a test.

import { DoctorAuditList } from "./DoctorAuditList";
import { DoctorPanel } from "./DoctorPanel";
import { DoctorPanelBody } from "./DoctorPanelBody";
import { DoctorProfileEditor } from "./DoctorProfileEditor";
import { LicenseSection } from "./LicenseSection";
import type { DoctorDetail } from "@/lib/admin/doctorDetail";
import type { SpecialtyChoice } from "@/lib/specialties/catalogue";
import type { SavedWorkplace, WorkplaceType } from "@/lib/workplace";

export function DoctorPanelSlot({
  detail,
  specialties,
  editing,
  closeHref,
  viewHref,
  editHref,
}: {
  detail: DoctorDetail | null;
  /** The catalogue the picker needs; only read when editing. */
  specialties: SpecialtyChoice[];
  editing: boolean;
  /** Where إغلاق goes: the list the admin came from. */
  closeHref: string;
  /** This panel, read-only. */
  viewHref: string;
  /** This panel, with the editor open. */
  editHref: string;
}) {
  if (!detail) {
    return (
      <DoctorPanel closeHref={closeHref} title="الطبيب">
        <p className="text-sm text-muted">هذا الحساب غير موجود (ربما حُذف).</p>
      </DoctorPanel>
    );
  }

  const d = detail.doctor;
  const title = `د. ${d.arabic_first_name} ${d.arabic_family_name}`;

  if (!editing) {
    return (
      <DoctorPanel closeHref={closeHref} title={title}>
        <DoctorPanelBody detail={detail} closeHref={closeHref} editHref={editHref} />
      </DoctorPanel>
    );
  }

  return (
    <DoctorPanel closeHref={closeHref} title={`تعديل ملف ${title}`} width="lg">
      <DoctorProfileEditor
        doctor={{
          id: d.id,
          arabic_first_name: d.arabic_first_name,
          arabic_family_name: d.arabic_family_name,
          hebrew_first_name: d.hebrew_first_name,
          hebrew_family_name: d.hebrew_family_name,
          phone_e164: d.phone_e164,
          phone_display: d.phone_display,
          is_phone_verified: d.is_phone_verified,
          email: d.email,
          subspecialty: d.subspecialty,
          bio: d.bio,
          certificates: d.certificates,
          seeking_work: d.seeking_work,
          retired: d.retired,
          career_stage: d.career_stage,
          residency_start_year: d.residency_start_year,
          profile_picture_url: d.profile_picture_url,
          auth_user_id: d.auth_user_id,
        }}
        specialties={specialties}
        specialtyIds={detail.specialtyIds}
        workplaces={detail.workplaces.map((w) => ({
          ...w,
          workplace_type: w.workplace_type as WorkplaceType,
        })) as SavedWorkplace[]}
        cancelHref={viewHref}
      />

      {/* The licence is the natural follow-up to a Hebrew-name edit, and the
          activity list is how the admin sees the save landed. */}
      <section className="flex flex-col gap-4 border-t border-line pt-4">
        <h3 className="text-base font-semibold">التحقق من الترخيص</h3>
        {detail.licenses.map((slot) => (
          <LicenseSection key={slot.slot} doctorId={d.id} slot={slot} />
        ))}
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-base font-semibold">آخر الأحداث</h3>
        <DoctorAuditList audit={detail.audit} />
      </section>
    </DoctorPanel>
  );
}
