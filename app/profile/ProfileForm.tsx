"use client";

import { apiErrorMessage, fieldErrorMessage } from "@/lib/client/apiError";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DeleteAccountSection, HelpSection } from "./AccountSections";
import { PhotoUploader } from "./PhotoUploader";
import { EditButton, LockableField, ReadOnlyView, Section } from "./ProfileFields";
import {
  FixedInfoSection,
  SpecialtiesSummary,
  StageSummary,
  WorkplacesSummary,
} from "./ProfileSummaries";
import { CertificatesEditor } from "@/components/CertificatesEditor";
import { Field, SeekingWorkCheckbox } from "@/components/FormField";
import { InputStyles } from "@/components/InputStyles";
import { SpecialtyPicker } from "@/components/SpecialtyPicker";
import { StageRadios } from "@/components/StageRadios";
import { WorkplaceEditor } from "@/components/WorkplaceEditor";
import {
  findGeneralSpecialtyId,
  RESIDENCY_YEAR_MIN,
  residencyYearMax,
  STAGE_BY_KEY,
  type Stage,
  initialProfileStage,
  workplaceForStage,
} from "@/lib/careerStage";
import type { Doctor } from "@/lib/db/types";
import { clinicsMissingDetails, profileFormError } from "@/lib/profile/validate";
import type { SpecialtyNode } from "@/lib/specialtyTree";
import {
  cleanWorkplaces,
  toWorkplaceEntries,
  type SavedWorkplace,
  type WorkplaceEntry,
} from "@/lib/workplace";

type Specialty = SpecialtyNode & { code: string | null };

export function ProfileForm({
  doctor,
  specialties,
  currentSpecialtyIds,
  currentWorkplaces,
}: {
  doctor: Doctor;
  specialties: Specialty[];
  currentSpecialtyIds: string[];
  currentWorkplaces: SavedWorkplace[];
}) {
  const router = useRouter();
  const [arabicFirst, setArabicFirst] = useState(doctor.arabic_first_name);
  const [arabicFamily, setArabicFamily] = useState(doctor.arabic_family_name);
  const [email, setEmail] = useState(doctor.email ?? "");
  const [subspecialty, setSubspecialty] = useState(doctor.subspecialty ?? "");
  const [bio, setBio] = useState(doctor.bio ?? "");
  const [certificates, setCertificates] = useState<string[]>(doctor.certificates ?? []);
  const [seekingWork, setSeekingWork] = useState(doctor.seeking_work ?? false);
  const [specialtyIds, setSpecialtyIds] = useState<string[]>(
    currentSpecialtyIds,
  );
  const [workplaces, setWorkplaces] =
    useState<WorkplaceEntry[]>(() =>
    toWorkplaceEntries(currentWorkplaces),
  );
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    doctor.profile_picture_url,
  );

  // Null, not طب عام, for a doctor who has never declared a stage:
  // pre-selecting طب عام would mean that saving any unrelated field silently
  // replaces their specialties with الطب العام, because /api/profile writes
  // specialties replace-all. A declared طب عام is told apart by its specialty.
  const [stage, setStage] = useState<Stage | null>(() =>
    initialProfileStage(
      doctor.career_stage,
      currentSpecialtyIds,
      findGeneralSpecialtyId(specialties),
    ),
  );
  const [residencyStartYear, setResidencyStartYear] = useState(
    doctor.residency_start_year ? String(doctor.residency_start_year) : "",
  );
  const [stageChanged, setStageChanged] = useState(false);

  const [editingStage, setEditingStage] = useState(false);
  const [editingSpecialties, setEditingSpecialties] = useState(false);
  const [editingWorkplaces, setEditingWorkplaces] = useState(false);

  const generalSpecialtyId = findGeneralSpecialtyId(specialties);
  const stageOpt = stage ? STAGE_BY_KEY[stage] : null;
  const showSpecialtyPicker =
    !stageOpt ||
    stageOpt.showsSpecialtyPicker ||
    (stageOpt.autoAttachesGeneralSpecialty && !generalSpecialtyId);
  const visibleSpecialties =
    stageOpt?.excludesGeneralSpecialty && generalSpecialtyId
      ? specialties.filter((s) => s.id !== generalSpecialtyId)
      : specialties;

  /**
   * Same cascade as signup. Both affected sections are force-opened so the
   * doctor sees what the switch did to their specialties and workplaces
   * before saving, instead of discovering it afterwards.
   */
  const applyStage = (next: Stage) => {
    const opt = STAGE_BY_KEY[next];
    setStage(next);
    setStageChanged(true);
    if (opt.autoAttachesGeneralSpecialty) {
      // Replace rather than append: a doctor already at the 5-specialty cap
      // would otherwise produce a 6-element array that fails zod with a bare
      // invalid_body and no field message.
      setSpecialtyIds(generalSpecialtyId ? [generalSpecialtyId] : []);
      setSubspecialty("");
      setEditingSpecialties(true);
    } else if (generalSpecialtyId && specialtyIds.includes(generalSpecialtyId)) {
      setSpecialtyIds((ids) => ids.filter((id) => id !== generalSpecialtyId));
      setEditingSpecialties(true);
    }
    if (!opt.requiresResidencyStartYear) setResidencyStartYear("");
    if (!opt.showsCertificates) setCertificates([]);
    // Untouched rows adopt the stage's default type; named ones are only
    // corrected when the new stage doesn't offer their type.
    const coerced = workplaces.map((w) =>
      workplaceForStage(
        w.name.trim() === ""
          ? { ...w, workplace_type: opt.defaultWorkplaceType }
          : w,
        next,
      ),
    );
    if (coerced.some((w, i) => w !== workplaces[i])) {
      setWorkplaces(coerced);
      setEditingWorkplaces(true);
    }
  };

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const problem = profileFormError({
      stageOpt,
      workplaces,
      specialtyIds,
      residencyStartYear,
    });
    if (problem) {
      setError(problem.message);
      if (problem.openWorkplaces) setEditingWorkplaces(true);
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arabic_first_name: arabicFirst,
          arabic_family_name: arabicFamily,
          email,
          subspecialty: subspecialty.trim() || null,
          bio: bio.trim() || null,
          specialty_ids: specialtyIds,
          // Omitted entirely while the doctor has never declared a stage, so
          // an unrelated save can't write a career_stage they didn't choose.
          ...(stage !== null && {
            career_stage: STAGE_BY_KEY[stage].careerStage,
            residency_start_year:
              stage === "resident" && residencyStartYear
                ? Number(residencyStartYear)
                : null,
            certificates: STAGE_BY_KEY[stage].showsCertificates ? certificates : [],
          }),
          seeking_work: seekingWork,
          workplaces: cleanWorkplaces(workplaces),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.fields?.workplaces ?? fieldErrorMessage(body?.fields) ?? apiErrorMessage(body?.code));
        setSaving(false);
        return;
      }
      setSaved(true);
      setSaving(false);
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("خطأ في الاتصال بالخادم.");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-8 sm:gap-6">
      <Section title="الصورة الشخصية">
        <PhotoUploader
          currentUrl={photoUrl}
          fallback={arabicFirst}
          onUploaded={(url) => setPhotoUrl(url)}
        />
      </Section>

      <FixedInfoSection doctor={doctor} />

      <Section title="الاسم بالعربية والبريد">
        <p className="text-sm text-foreground/65">
          هذه الحقول مقفلة افتراضيًا لتقليل الأخطاء. اضغط &quot;تعديل&quot;
          لإلغاء القفل.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LockableField
            label="الاسم"
            value={arabicFirst}
            onChange={setArabicFirst}
          />
          <LockableField
            label="اسم العائلة"
            value={arabicFamily}
            onChange={setArabicFamily}
          />
        </div>
        <LockableField
          label="البريد الإلكتروني"
          value={email}
          onChange={setEmail}
          type="email"
          dir="ltr"
        />
      </Section>

      <Section
        title="المرحلة المهنية"
        action={
          editingStage ? null : (
            <EditButton onClick={() => setEditingStage(true)} />
          )
        }
      >
        {editingStage ? (
          <>
            <StageRadios value={stage} onChange={applyStage} />
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
                  placeholder={String(residencyYearMax())}
                />
              </Field>
            )}
            {stageChanged && stageOpt?.autoAttachesGeneralSpecialty && (
              <p className="rounded border border-amber-300/60 bg-amber-50/60 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
                اختيار «طب عام» يستبدل تخصصاتك المحفوظة بـ«الطب العام» عند
                الحفظ.
              </p>
            )}
          </>
        ) : (
          <ReadOnlyView>
            <StageSummary stageOpt={stageOpt} residencyStartYear={residencyStartYear} />
          </ReadOnlyView>
        )}
        <SeekingWorkCheckbox checked={seekingWork} onChange={setSeekingWork} />
      </Section>

      <Section
        title="التخصص"
        action={
          editingSpecialties ? null : (
            <EditButton onClick={() => setEditingSpecialties(true)} />
          )
        }
      >
        {editingSpecialties ? (
          <>
            {showSpecialtyPicker && (
            <Field label="التخصصات (اختر واحدًا أو أكثر)">
              <SpecialtyPicker
                id="specialty_ids"
                specialties={visibleSpecialties}
                selected={specialtyIds}
                onChange={setSpecialtyIds}
              />
            </Field>
            )}
            {showSpecialtyPicker && (
            <Field label="التخصص الدقيق أو مجال الاهتمام">
              <input
                className="input"
                value={subspecialty}
                onChange={(e) => setSubspecialty(e.target.value)}
                placeholder="اختياري"
              />
            </Field>
            )}
            {stageOpt?.showsCertificates && (
              <Field label="شهادات إضافية (تظهر على بطاقتك بدل «الطب العام»)" htmlFor="certificates">
                <CertificatesEditor
                  id="certificates"
                  value={certificates}
                  onChange={setCertificates}
                />
              </Field>
            )}
            <Field label="نبذة عني">
              <textarea
                className="input"
                rows={3}
                maxLength={500}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="اختياري — خبرة، اهتمامات مهنية، أو أي شيء تريد زملاءك أن يعرفوه"
              />
            </Field>
          </>
        ) : (
          <ReadOnlyView>
            <SpecialtiesSummary
              specialties={specialties}
              specialtyIds={specialtyIds}
              showSubspecialty={showSpecialtyPicker}
              subspecialty={subspecialty}
              showCertificates={Boolean(stageOpt?.showsCertificates)}
              certificates={certificates}
              bio={bio}
            />
          </ReadOnlyView>
        )}
      </Section>

      <Section
        title="مكان العمل"
        action={
          editingWorkplaces ? null : (
            <EditButton onClick={() => setEditingWorkplaces(true)} />
          )
        }
      >
        {editingWorkplaces ? (
          <WorkplaceEditor
            workplaces={workplaces}
            onChange={setWorkplaces}
            stage={stage}
          />
        ) : (
          <ReadOnlyView>
            <WorkplacesSummary workplaces={workplaces} />
          </ReadOnlyView>
        )}
        {clinicsMissingDetails(stageOpt, workplaces).length > 0 && (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            أضف عنوان وهاتف {clinicsMissingDetails(stageOpt, workplaces).join("، ")} ليتمكّن
            الزملاء من الوصول إلى عيادتك والاتصال بها مباشرة.
          </p>
        )}
      </Section>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          تم حفظ التعديلات.
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-md bg-foreground px-6 py-3 text-background disabled:opacity-50"
      >
        {saving ? "جارٍ الحفظ..." : "حفظ التعديلات"}
      </button>

      <HelpSection />

      <DeleteAccountSection onError={setError} />

      <InputStyles />
    </form>
  );
}
