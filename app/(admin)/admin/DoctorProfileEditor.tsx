"use client";

// An admin editing any part of a doctor's profile, inside the panel.
//
// Not app/profile/ProfileForm.tsx with props: three of that form's sections
// are actively wrong here — "الحذف النهائي" there posts a deletion request
// as the *signed-in* account, the help text is addressed to the doctor, and
// "معلومات ثابتة" exists to present phone, licence and Hebrew name as
// unchangeable, which is the opposite of this screen's whole purpose. What
// is genuinely shared is shared: the field components below, the client
// pre-checks in lib/profile/validate.ts, and on the server every rule in
// lib/profile/save.ts.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhotoUploader } from "@/app/profile/PhotoUploader";
import { CertificatesEditor } from "@/components/CertificatesEditor";
import { Field, RetiredCheckbox, SeekingWorkCheckbox } from "@/components/FormField";
import { InputStyles } from "@/components/InputStyles";
import { SpecialtyPicker } from "@/components/SpecialtyPicker";
import { StageRadios } from "@/components/StageRadios";
import { WorkplaceEditor } from "@/components/WorkplaceEditor";
import { apiErrorMessage, fieldErrorMessage } from "@/lib/client/apiError";
import {
  applyStageCascade,
  findGeneralSpecialtyId,
  RESIDENCY_YEAR_MIN,
  residencyYearMax,
  STAGE_BY_KEY,
  stageFromCareerStage,
  type Stage,
  RESIDENT_NOT_RETIRED,
} from "@/lib/careerStage";
import { profileFormError } from "@/lib/profile/validate";
import type { SpecialtyChoice } from "@/lib/specialties/catalogue";
import { cleanWorkplaces, toWorkplaceEntries, type SavedWorkplace, type WorkplaceEntry } from "@/lib/workplace";

export interface AdminEditDoctor {
  id: string;
  arabic_first_name: string;
  arabic_family_name: string;
  hebrew_first_name: string | null;
  hebrew_family_name: string | null;
  phone_e164: string;
  phone_display: string | null;
  is_phone_verified: boolean;
  email: string | null;
  subspecialty: string | null;
  bio: string | null;
  certificates: string[] | null;
  seeking_work: boolean;
  retired: boolean;
  career_stage: "resident" | "specialist" | null;
  residency_start_year: number | null;
  profile_picture_url: string | null;
  auth_user_id: string | null;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function DoctorProfileEditor({
  doctor,
  specialties,
  specialtyIds: savedSpecialtyIds,
  workplaces: savedWorkplaces,
  cancelHref,
}: {
  doctor: AdminEditDoctor;
  specialties: SpecialtyChoice[];
  specialtyIds: string[];
  workplaces: SavedWorkplace[];
  /** This panel with the editor closed. */
  cancelHref: string;
}) {
  const router = useRouter();

  const [arabicFirst, setArabicFirst] = useState(doctor.arabic_first_name);
  const [arabicFamily, setArabicFamily] = useState(doctor.arabic_family_name);
  const [hebrewFirst, setHebrewFirst] = useState(doctor.hebrew_first_name ?? "");
  const [hebrewFamily, setHebrewFamily] = useState(doctor.hebrew_family_name ?? "");
  const [phone, setPhone] = useState(doctor.phone_display || doctor.phone_e164);
  const [phoneVerified, setPhoneVerified] = useState(doctor.is_phone_verified);
  const [email, setEmail] = useState(doctor.email ?? "");
  const [subspecialty, setSubspecialty] = useState(doctor.subspecialty ?? "");
  const [bio, setBio] = useState(doctor.bio ?? "");
  const [certificates, setCertificates] = useState<string[]>(doctor.certificates ?? []);
  const [seekingWork, setSeekingWork] = useState(doctor.seeking_work);
  const [retired, setRetired] = useState(doctor.retired);
  const [specialtyIds, setSpecialtyIds] = useState<string[]>(savedSpecialtyIds);
  const [workplaces, setWorkplaces] = useState<WorkplaceEntry[]>(() => toWorkplaceEntries(savedWorkplaces));
  const [photoUrl, setPhotoUrl] = useState<string | null>(doctor.profile_picture_url);

  // The stored value, shown as it is. The doctor's own form infers a null
  // stage from their specialties so an unrelated save can't declare طب عام
  // for them; an admin is here to see and set what is actually recorded.
  const [stage, setStage] = useState<Stage | null>(stageFromCareerStage(doctor.career_stage));
  const [residencyStartYear, setResidencyStartYear] = useState(
    doctor.residency_start_year ? String(doctor.residency_start_year) : "",
  );

  const generalSpecialtyId = findGeneralSpecialtyId(specialties);
  const stageOpt = stage ? STAGE_BY_KEY[stage] : null;
  const showSpecialtyPicker =
    !stageOpt || stageOpt.showsSpecialtyPicker || (stageOpt.autoAttachesGeneralSpecialty && !generalSpecialtyId);
  const visibleSpecialties =
    stageOpt?.excludesGeneralSpecialty && generalSpecialtyId
      ? specialties.filter((s) => s.id !== generalSpecialtyId)
      : specialties;

  const applyStage = (next: Stage) => {
    const c = applyStageCascade(next, { specialtyIds, workplaces, generalSpecialtyId });
    setStage(next);
    setSpecialtyIds(c.specialtyIds);
    if (c.clearSubspecialty) setSubspecialty("");
    if (c.clearResidencyYear) setResidencyStartYear("");
    if (c.clearCertificates) setCertificates([]);
    setWorkplaces(c.workplaces);
  };

  const storedPhone = doctor.phone_display || doctor.phone_e164;
  const phoneChanged = phone.trim() !== storedPhone;

  /** Only what the admin actually changed goes to the server, so the
   *  activity log names the edit instead of listing the whole profile. */
  const changes = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    const put = (key: string, value: unknown, before: unknown) => {
      if (JSON.stringify(value) !== JSON.stringify(before)) body[key] = value;
    };
    put("arabic_first_name", arabicFirst, doctor.arabic_first_name);
    put("arabic_family_name", arabicFamily, doctor.arabic_family_name);
    put("hebrew_first_name", hebrewFirst.trim() || null, doctor.hebrew_first_name);
    put("hebrew_family_name", hebrewFamily.trim() || null, doctor.hebrew_family_name);
    if (phoneChanged) body.phone = phone.trim();
    put("is_phone_verified", phoneVerified, doctor.is_phone_verified);
    put("email", email, doctor.email ?? "");
    put("subspecialty", subspecialty.trim() || null, doctor.subspecialty);
    put("bio", bio.trim() || null, doctor.bio);
    put("seeking_work", seekingWork, doctor.seeking_work);
    put("retired", retired, doctor.retired);
    put("specialty_ids", [...specialtyIds].sort(), [...savedSpecialtyIds].sort());
    if (stage !== null) {
      const opt = STAGE_BY_KEY[stage];
      put("career_stage", opt.careerStage, doctor.career_stage);
      put(
        "residency_start_year",
        stage === "resident" && residencyStartYear ? Number(residencyStartYear) : null,
        doctor.residency_start_year,
      );
      put("certificates", opt.showsCertificates ? certificates : [], doctor.certificates ?? []);
    }
    put("workplaces", cleanWorkplaces(workplaces), cleanWorkplaces(toWorkplaceEntries(savedWorkplaces)));
    // Replace-all lists are only meaningful whole; a sorted comparison above
    // decides *whether* to send them, this sends them as the form holds them.
    if (body.specialty_ids) body.specialty_ids = specialtyIds;
    return body;
  };

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  const submit = async (e: React.FormEvent, confirmPhoneRisk = false) => {
    e.preventDefault();
    setError(null);
    setNotes([]);

    const problem = profileFormError({ stageOpt, workplaces, specialtyIds, residencyStartYear, seekingWork, retired });
    if (problem) {
      setError(problem.message);
      return;
    }

    const body = changes();
    if (Object.keys(body).length === 0) {
      setError("لا يوجد تغيير لحفظه.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/doctors/${doctor.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmPhoneRisk ? { ...body, confirm_phone_risk: true } : body),
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        // A number that cannot receive an OTP is refused once, then allowed
        // on an explicit second press: the doctor would otherwise be locked
        // out of their own account with no self-service way back.
        if (payload?.code === "phone_not_sms_deliverable" && !confirmPhoneRisk) {
          setSaving(false);
          if (window.confirm(`${payload.fields?.phone ?? ""}\n\nهل تريد الحفظ على أي حال؟`)) {
            void submit(e, true);
          }
          return;
        }
        setError(fieldErrorMessage(payload?.fields) ?? apiErrorMessage(payload?.code, "تعذّر الحفظ. حاول مجددًا."));
        setSaving(false);
        return;
      }

      const after: string[] = [];
      if (payload?.hebrew_name_changed) {
        after.push("تغيّر الاسم بالعبرية. أعد فحص الترخيص من قسم «التحقق من الترخيص» لتحديث حالة التحقق.");
      }
      if ((payload?.warnings ?? []).includes("no_login_account")) {
        after.push("لا يوجد حساب دخول مرتبط بهذا الطبيب بعد؛ سيُربط عند أول دخول بالرقم الجديد.");
      }
      setNotes(after);
      setSaving(false);
      router.refresh();
      if (after.length === 0) router.push(cancelHref, { scroll: false });
    } catch (err) {
      console.error(err);
      setError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا.");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      <InputStyles />

      <PhotoUploader
        currentUrl={photoUrl}
        fallback={arabicFirst}
        onUploaded={(url) => {
          setPhotoUrl(url);
          router.refresh();
        }}
        endpoint={`/api/admin/doctors/${doctor.id}/photo`}
      />

      <Block title="الاسم">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الاسم بالعربية">
            <input className="input" value={arabicFirst} onChange={(e) => setArabicFirst(e.target.value)} />
          </Field>
          <Field label="اسم العائلة بالعربية">
            <input className="input" value={arabicFamily} onChange={(e) => setArabicFamily(e.target.value)} />
          </Field>
          <Field label="الاسم الأول بالعبرية">
            <input className="input" dir="ltr" value={hebrewFirst} onChange={(e) => setHebrewFirst(e.target.value)} />
          </Field>
          <Field label="اسم العائلة بالعبرية">
            <input className="input" dir="ltr" value={hebrewFamily} onChange={(e) => setHebrewFamily(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted">
          الاسم بالعبرية هو ما يُقارَن بسجل وزارة الصحة. بعد تغييره أعد فحص الترخيص.
        </p>
      </Block>

      <Block title="التواصل والدخول">
        <Field label="رقم الهاتف">
          <input className="input" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <p className={"text-xs " + (phoneChanged ? "text-warn" : "text-muted")}>
          رقم الهاتف هو هوية الدخول: تغييره ينقل حساب الدخول معه، ويدخل الطبيب برمز يصل إلى
          الرقم الجديد.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={phoneVerified}
            onChange={(e) => setPhoneVerified(e.target.checked)}
            className="size-4"
          />
          <span>الهاتف موثّق</span>
        </label>
        <p className="text-xs text-muted">
          إلغاء التوثيق يُخفي الطبيب من الدليل ويمنعه من الدخول. لا يتغيّر تلقائيًا عند تبديل الرقم.
        </p>
        <Field label="البريد الإلكتروني">
          <input className="input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </Block>

      <Block title="المرحلة المهنية">
        <StageRadios
              value={stage}
              onChange={applyStage}
              disabled={retired && stage !== "resident" ? { resident: RESIDENT_NOT_RETIRED.resident } : {}}
            />
        {stageOpt?.requiresResidencyStartYear && (
          <Field label="سنة بداية التخصص">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              dir="ltr"
              min={RESIDENCY_YEAR_MIN}
              max={residencyYearMax()}
              value={residencyStartYear}
              onChange={(e) => setResidencyStartYear(e.target.value)}
            />
          </Field>
        )}
        <SeekingWorkCheckbox checked={seekingWork} onChange={setSeekingWork} />
        <RetiredCheckbox
          checked={retired}
          onChange={setRetired}
          disabledReason={stage === "resident" && !retired ? RESIDENT_NOT_RETIRED.retired : undefined}
        />
      </Block>

      <Block title="التخصص">
        {showSpecialtyPicker && (
          <>
            <Field label="التخصصات (اختر واحدًا أو أكثر)">
              <SpecialtyPicker
                id="admin_specialty_ids"
                specialties={visibleSpecialties}
                selected={specialtyIds}
                onChange={setSpecialtyIds}
              />
            </Field>
            <Field label="التخصص الدقيق أو مجال الاهتمام">
              <input className="input" value={subspecialty} onChange={(e) => setSubspecialty(e.target.value)} />
            </Field>
          </>
        )}
        {stageOpt?.showsCertificates && (
          <Field label="شهادات وخدمات" htmlFor="admin_certificates">
            <CertificatesEditor id="admin_certificates" value={certificates} onChange={setCertificates} />
          </Field>
        )}
        <Field label="نبذة">
          <textarea className="input" rows={3} maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} />
        </Field>
      </Block>

      <Block title="أماكن العمل">
        <WorkplaceEditor workplaces={workplaces} onChange={setWorkplaces} stage={stage} optional={seekingWork || retired} />
      </Block>

      {error && (
        <p role="alert" className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
          {error}
        </p>
      )}
      {notes.map((n) => (
        <p key={n} role="status" className="rounded border border-warn-line bg-warn-bg p-3 text-sm text-warn">
          {n}
        </p>
      ))}

      <div className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-5 py-2 font-semibold text-primary-fg disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ..." : "حفظ الملف"}
        </button>
        <button
          type="button"
          onClick={() => router.push(cancelHref, { scroll: false })}
          className="rounded-md border border-line px-4 py-2 text-sm hover:bg-foreground/5"
        >
          إنهاء التعديل
        </button>
      </div>
    </form>
  );
}
