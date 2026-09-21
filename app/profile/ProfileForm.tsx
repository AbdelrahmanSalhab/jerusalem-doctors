"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhotoUploader } from "./PhotoUploader";
import {
  findGeneralSpecialtyId,
  isValidResidencyYear,
  RESIDENCY_YEAR_MIN,
  residencyYearMax,
  STAGE_BY_KEY,
  STAGE_OPTIONS,
  type Stage,
  stageFromCareerStage,
  workplaceForStage,
} from "@/lib/careerStage";
import type { Doctor } from "@/lib/db/types";
import {
  WORKPLACE_TYPE_LABEL,
  WORKPLACE_TYPES,
  type WorkplaceType,
} from "@/lib/workplace";

const LINKEDIN_URL = "https://www.linkedin.com/in/abdelrahman-salhab/";
const WHATSAPP_URL = "https://wa.me/972524209156";

type Specialty = { id: string; name_ar: string; code: string | null };
type WorkplaceInput = {
  name: string;
  workplace_type: WorkplaceType;
  details: string;
  is_primary: boolean;
};

export function ProfileForm({
  doctor,
  specialties,
  currentSpecialtyIds,
  currentWorkplaces,
}: {
  doctor: Doctor;
  specialties: Specialty[];
  currentSpecialtyIds: string[];
  currentWorkplaces: {
    name: string;
    workplace_type: WorkplaceType;
    details: string | null;
    is_primary: boolean;
    sort_order: number;
  }[];
}) {
  const router = useRouter();
  const [arabicFirst, setArabicFirst] = useState(doctor.arabic_first_name);
  const [arabicFamily, setArabicFamily] = useState(doctor.arabic_family_name);
  const [email, setEmail] = useState(doctor.email ?? "");
  const [subspecialty, setSubspecialty] = useState(doctor.subspecialty ?? "");
  const [bio, setBio] = useState(doctor.bio ?? "");
  const [specialtyIds, setSpecialtyIds] = useState<string[]>(
    currentSpecialtyIds,
  );
  const initialWorkplaces: WorkplaceInput[] =
    currentWorkplaces.length > 0
      ? currentWorkplaces.map((w) => ({
          name: w.name,
          workplace_type: w.workplace_type,
          details: w.details ?? "",
          is_primary: w.is_primary,
        }))
      : [{ name: "", workplace_type: "hospital", details: "", is_primary: true }];
  const [workplaces, setWorkplaces] =
    useState<WorkplaceInput[]>(initialWorkplaces);
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    doctor.profile_picture_url,
  );

  // Deliberately null — not stageFromCareerStage(null) — for a doctor who has
  // never declared a stage. Pre-selecting طب عام would mean that saving any
  // unrelated field silently replaces their specialties with الطب العام,
  // because /api/profile writes specialties replace-all.
  const [stage, setStage] = useState<Stage | null>(
    doctor.career_stage === null
      ? null
      : stageFromCareerStage(doctor.career_stage),
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

  const toggleSpecialty = (id: string) =>
    setSpecialtyIds((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  const setPrimary = (i: number) =>
    setWorkplaces((ws) => ws.map((w, j) => ({ ...w, is_primary: j === i })));

  const updateWorkplace = (i: number, patch: Partial<WorkplaceInput>) =>
    setWorkplaces((ws) =>
      ws.map((w, j) => (j === i ? { ...w, ...patch } : w)),
    );

  /** Clears `details` when the new type hides that input — see signup. */
  const setWorkplaceType = (i: number, workplace_type: WorkplaceType) =>
    setWorkplaces((ws) =>
      ws.map((w, j) =>
        j === i && stage
          ? workplaceForStage({ ...w, workplace_type }, stage)
          : { ...w, workplace_type },
      ),
    );

  const removeWorkplace = (i: number) =>
    setWorkplaces((ws) => {
      const next = ws.filter((_, j) => j !== i);
      // Ensure at least one entry exists and exactly one is primary.
      if (next.length === 0) {
        return [
          { name: "", workplace_type: "hospital", details: "", is_primary: true },
        ];
      }
      if (!next.some((w) => w.is_primary)) {
        next[0] = { ...next[0]!, is_primary: true };
      }
      return next;
    });

  const addWorkplace = () =>
    setWorkplaces((ws) => [
      ...ws,
      { name: "", workplace_type: "hospital", details: "", is_primary: false },
    ]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const cleanedWorkplaces = workplaces
      .map((w) => ({
        name: w.name.trim(),
        workplace_type: w.workplace_type,
        details: w.details.trim() || null,
        is_primary: w.is_primary,
      }))
      .filter((w) => w.name.length > 0);

    if (cleanedWorkplaces.length === 0) {
      setError("الرجاء إدخال مكان عمل واحد على الأقل.");
      setSaving(false);
      return;
    }
    const primaryCount = cleanedWorkplaces.filter((w) => w.is_primary).length;
    if (primaryCount !== 1) {
      setError("اختر مكان عمل رئيسي واحد فقط.");
      setSaving(false);
      return;
    }
    if (specialtyIds.length === 0) {
      setError("اختر تخصصًا واحدًا على الأقل.");
      setSaving(false);
      return;
    }
    if (
      stageOpt?.requiresResidencyStartYear &&
      !isValidResidencyYear(residencyStartYear)
    ) {
      setError("أدخل سنة بداية التخصص.");
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
          }),
          workplaces: cleanedWorkplaces,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.fields?.workplaces ?? body?.error ?? "حدث خطأ.");
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

  const requestDelete = async () => {
    const ok = window.confirm(
      "هل أنت متأكد؟ سيتم إخفاء حسابك من البحث فورًا، وسيقوم المسؤول بالمراجعة.",
    );
    if (!ok) return;
    const res = await fetch("/api/profile/delete-request", { method: "POST" });
    if (res.ok) {
      window.location.href = "/";
    } else {
      setError("لم نتمكن من تسجيل طلب الحذف.");
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

      <Section title="معلومات ثابتة">
        <p className="text-sm text-foreground/65">
          هذه المعلومات لا يمكن تعديلها ذاتيًا. للحاجة إلى تعديل، تواصل مع
          المطوّر من زر الأسفل.
        </p>
        <Locked label="رقم الهاتف">{doctor.phone_e164}</Locked>
        <Locked label="رقم الترخيص">
          {doctor.license_number}{" "}
          <span className="text-foreground/50">
            ({doctor.license_region === "IL" ? "إسرائيلي" : "فلسطيني"})
          </span>
        </Locked>
        {doctor.secondary_license_number && (
          <Locked label="ترخيص إضافي">
            {doctor.secondary_license_number}{" "}
            <span className="text-foreground/50">
              ({doctor.secondary_license_region === "IL" ? "إسرائيلي" : "فلسطيني"})
            </span>
          </Locked>
        )}
        {(doctor.hebrew_first_name || doctor.hebrew_family_name) && (
          <Locked label="الاسم بالعبرية">
            {doctor.hebrew_first_name} {doctor.hebrew_family_name}
          </Locked>
        )}
      </Section>

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
            <div className="flex flex-col gap-2">
              {STAGE_OPTIONS.map((o) => (
                <label key={o.stage} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="stage"
                    className="mt-1"
                    checked={stage === o.stage}
                    onChange={() => applyStage(o.stage)}
                  />
                  <span>
                    {o.label}
                    <span className="block text-sm text-foreground/60">
                      {o.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
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
            {stageOpt ? (
              <span>
                {stageOpt.label}
                {stageOpt.requiresResidencyStartYear && residencyStartYear
                  ? ` — بداية التخصص ${residencyStartYear}`
                  : ""}
              </span>
            ) : (
              <span className="text-foreground/40">— غير محدد —</span>
            )}
          </ReadOnlyView>
        )}
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
              <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded border border-foreground/15 p-2 sm:grid-cols-2">
                {visibleSpecialties.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 rounded p-1 hover:bg-foreground/5"
                  >
                    <input
                      type="checkbox"
                      checked={specialtyIds.includes(s.id)}
                      onChange={() => toggleSpecialty(s.id)}
                      disabled={
                        !specialtyIds.includes(s.id) &&
                        specialtyIds.length >= 5
                      }
                    />
                    <span>{s.name_ar}</span>
                  </label>
                ))}
              </div>
            </Field>
            )}
            {showSpecialtyPicker && (
            <Field label="التخصص الفرعي">
              <input
                className="input"
                value={subspecialty}
                onChange={(e) => setSubspecialty(e.target.value)}
                placeholder="اختياري"
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
            <div>
              <div className="mb-1 text-sm text-foreground/65">التخصصات</div>
              {specialtyIds.length === 0 ? (
                <span className="text-foreground/40">— لا يوجد —</span>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {specialties
                    .filter((s) => specialtyIds.includes(s.id))
                    .map((s) => (
                      <li
                        key={s.id}
                        className="rounded-full border border-foreground/20 bg-foreground/5 px-2.5 py-0.5 text-sm"
                      >
                        {s.name_ar}
                      </li>
                    ))}
                </ul>
              )}
            </div>
            {showSpecialtyPicker && (
              <div>
                <div className="mb-1 text-sm text-foreground/65">
                  التخصص الفرعي
                </div>
                <span>
                  {subspecialty || (
                    <span className="text-foreground/40">— غير محدد —</span>
                  )}
                </span>
              </div>
            )}
            <div>
              <div className="mb-1 text-sm text-foreground/65">نبذة عني</div>
              <span className="whitespace-pre-line">
                {bio || <span className="text-foreground/40">— غير محدد —</span>}
              </span>
            </div>
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
          <div className="space-y-3">
            {workplaces.map((wp, i) => (
              <div key={i} className="space-y-2 rounded border border-foreground/15 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input min-w-0 flex-1"
                    value={wp.name}
                    onChange={(e) => updateWorkplace(i, { name: e.target.value })}
                    placeholder="اسم العيادة أو المستشفى"
                  />
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="primary_workplace"
                      checked={wp.is_primary}
                      onChange={() => setPrimary(i)}
                    />
                    رئيسي
                  </label>
                  <button
                    type="button"
                    onClick={() => removeWorkplace(i)}
                    className="rounded border border-foreground/20 px-3 text-base hover:bg-foreground/5"
                    aria-label="حذف"
                  >
                    حذف
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {(stageOpt?.workplaceTypes ?? WORKPLACE_TYPES).map((t) => (
                    <label key={t} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`workplace_type_${i}`}
                        checked={wp.workplace_type === t}
                        onChange={() => setWorkplaceType(i, t)}
                      />
                      {WORKPLACE_TYPE_LABEL[t]}
                    </label>
                  ))}
                </div>
                {(stageOpt?.showsWorkplaceDetails ?? true) &&
                  wp.workplace_type === "clinic" && (
                  <input
                    className="input"
                    value={wp.details}
                    onChange={(e) => updateWorkplace(i, { details: e.target.value })}
                    placeholder="عنوان العيادة / أوقات الدوام / رقم الهاتف (اختياري)"
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addWorkplace}
              className="rounded border border-dashed border-foreground/30 px-4 py-2 text-base text-foreground/80 hover:bg-foreground/5"
            >
              + إضافة مكان عمل
            </button>
          </div>
        ) : (
          <ReadOnlyView>
            {workplaces.filter((w) => w.name.trim().length > 0).length === 0 ? (
              <span className="text-foreground/40">— لا يوجد —</span>
            ) : (
              <ul className="space-y-1">
                {workplaces
                  .filter((w) => w.name.trim().length > 0)
                  .map((w, i) => (
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
                      {w.details && (
                        <span className="text-foreground/60">
                          ({w.details})
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </ReadOnlyView>
        )}
      </Section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
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

      <Section title="بحاجة لمساعدة؟">
        <p className="text-sm text-foreground/75">
          لتعديل أي معلومة مقفلة، أو لطلب إخفاء كامل من البحث، تواصل مع
          المطوّر مباشرة.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-md bg-[#25d366] px-4 py-2.5 text-center font-medium text-white hover:opacity-90"
          >
            مراسلة المطوّر عبر واتساب
          </a>
          <a
            href={LINKEDIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-md border border-foreground/20 px-4 py-2.5 text-center hover:bg-foreground/5"
          >
            ملف LinkedIn
          </a>
        </div>
      </Section>

      <Section title="حذف الحساب">
        <p className="text-sm text-foreground/75">
          عند الضغط على الزر، سيتم إخفاء حسابك من البحث فورًا، وستتم مراجعة
          طلبك من قبل المسؤول.
        </p>
        <button
          type="button"
          onClick={requestDelete}
          className="rounded-md border border-red-400 px-4 py-2 text-red-700 hover:bg-red-50"
        >
          طلب حذف الحساب
        </button>
      </Section>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.75rem 0.875rem;
          font-size: 1rem;
          border-radius: 0.375rem;
          border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
          background: transparent;
        }
        :global(.input:focus) {
          outline: 2px solid currentColor;
          outline-offset: 1px;
        }
      `}</style>
    </form>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-foreground/15 p-5">
      <div className="flex items-center justify-between gap-2 border-b border-foreground/10 pb-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-foreground/20 px-3 py-1 text-sm hover:bg-foreground/5"
    >
      تعديل
    </button>
  );
}

function ReadOnlyView({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-md border border-foreground/15 bg-foreground/5 p-4">
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-base font-medium">{label}</label>
      {children}
    </div>
  );
}

function Locked({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground/65">
        {label}
      </label>
      <div className="rounded-md border border-dashed border-foreground/20 bg-foreground/5 px-3 py-2 text-foreground/80">
        {children}
      </div>
    </div>
  );
}

function LockableField({
  label,
  value,
  onChange,
  type = "text",
  dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  dir?: "ltr" | "rtl" | "auto";
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <label className="mb-1.5 block text-base font-medium">{label}</label>
      {editing ? (
        <input
          type={type}
          dir={dir}
          required
          autoFocus
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="flex items-stretch gap-2">
          <div
            className="flex flex-1 items-center rounded-md border border-foreground/15 bg-foreground/5 px-3 py-2.5 text-foreground/85"
            dir={dir}
          >
            {value || (
              <span className="text-foreground/40">— غير محدد —</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-foreground/20 px-3 text-sm hover:bg-foreground/5"
          >
            تعديل
          </button>
        </div>
      )}
    </div>
  );
}
