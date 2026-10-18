"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { Field, RequiredMark, SeekingWorkCheckbox } from "@/components/FormField";
import { CertificatesEditor } from "@/components/CertificatesEditor";
import { SpecialtyPicker } from "@/components/SpecialtyPicker";
import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/components/TurnstileWidget";
import { WorkplaceEditor } from "@/components/WorkplaceEditor";
import {
  findGeneralSpecialtyId,
  RESIDENCY_YEAR_MIN,
  residencyYearMax,
  STAGE_BY_KEY,
  STAGE_OPTIONS,
  type Stage,
  workplaceForStage,
} from "@/lib/careerStage";
import {
  SS_PHONE,
  SS_SESSION,
  setHandoff,
} from "@/lib/client/verify_handoff";
import { toAsciiDigits } from "@/lib/normalize/digits";
import { getMissingFields, needsHebrewName } from "@/lib/signup/missingFields";
import type { SpecialtyNode } from "@/lib/specialtyTree";
import { cleanWorkplaces, emptyWorkplace, type WorkplaceEntry } from "@/lib/workplace";
import { MissingFieldsNotice } from "./MissingFieldsNotice";

type Specialty = SpecialtyNode & { code: string | null };
type LicenseRegion = "IL" | "PS";

type FormState = {
  phone: string;
  license_region: LicenseRegion;
  license_number: string;
  has_secondary_license: boolean;
  secondary_license_region: LicenseRegion;
  secondary_license_number: string;
  arabic_first_name: string;
  arabic_family_name: string;
  hebrew_first_name: string;
  hebrew_family_name: string;
  /** The 3-way self-declared choice; null until the doctor picks one. */
  stage: Stage | null;
  /** Kept as a string so the controlled number input can be empty. */
  residency_start_year: string;
  specialty_ids: string[];
  subspecialty: string;
  email: string;
  bio: string;
  /** طب عام only; see lib/certificates.ts. */
  certificates: string[];
  seeking_work: boolean;
  workplaces: WorkplaceEntry[];
  consent: boolean;
};

const OTHER_REGION: Record<LicenseRegion, LicenseRegion> = { IL: "PS", PS: "IL" };

const INITIAL: FormState = {
  phone: "",
  license_region: "IL",
  license_number: "",
  has_secondary_license: false,
  secondary_license_region: "PS",
  secondary_license_number: "",
  arabic_first_name: "",
  arabic_family_name: "",
  hebrew_first_name: "",
  hebrew_family_name: "",
  stage: null,
  residency_start_year: "",
  specialty_ids: [],
  subspecialty: "",
  email: "",
  bio: "",
  certificates: [],
  seeking_work: false,
  workplaces: [emptyWorkplace(true)],
  consent: false,
};

// Strip disallowed chars from phone + license inputs so a paste of
// "Phone: 050-1234567" still produces a clean digit string. Arabic-Indic
// digits are converted first: an Arabic keyboard types ٠٥٠, and stripping
// them used to leave the field empty. Server-side normalization is the
// actual source of truth.
const cleanPhone = (next: string) =>
  toAsciiDigits(next).replace(/[^0-9+\-\s()]/g, "");

// An IL license may be typed the way registries.health.gov.il prints it —
// `1-189371`, profession code + serial — so the hyphen has to survive the
// input; the server reduces both forms to the serial. Only the first
// hyphen is kept, since there is only ever one.
// PS licenses have no confirmed public format, so we only strip characters
// that would break the request.
const cleanLicense = (region: LicenseRegion, next: string) => {
  const ascii = toAsciiDigits(next);
  if (region === "PS") return ascii.replace(/[,()]/g, "");
  const cleaned = ascii.replace(/[^\d-]/g, "");
  const cut = cleaned.indexOf("-");
  return cut === -1
    ? cleaned
    : cleaned.slice(0, cut + 1) + cleaned.slice(cut + 1).replace(/-/g, "");
};

export function SignupForm({ specialties }: { specialties: Specialty[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [overrideMismatch, setOverrideMismatch] = useState(false);
  const [registryName, setRegistryName] = useState<{
    first?: string;
    family?: string;
  } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  const handleTurnstileToken = useCallback(
    (t: string) => setTurnstileToken(t),
    [],
  );

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const generalSpecialtyId = useMemo(
    () => findGeneralSpecialtyId(specialties),
    [specialties],
  );
  const stageOpt = form.stage ? STAGE_BY_KEY[form.stage] : null;
  // A طب عام signup posts the الطب العام specialty on the doctor's behalf.
  // If that row has been deactivated from /admin/specialties there is nothing
  // to attach, and a silently empty specialty_ids would leave submit disabled
  // with no explanation — so fall back to showing the normal picker.
  const showSpecialtyPicker =
    !!stageOpt &&
    (stageOpt.showsSpecialtyPicker ||
      (stageOpt.autoAttachesGeneralSpecialty && !generalSpecialtyId));
  const visibleSpecialties =
    stageOpt?.excludesGeneralSpecialty && generalSpecialtyId
      ? specialties.filter((s) => s.id !== generalSpecialtyId)
      : specialties;

  const missing = getMissingFields(form);
  const hebrewRequired = needsHebrewName(form);

  /**
   * Everything the choice implies, applied in one update so the form can
   * never render a state that contradicts it: the auto-attached specialty,
   * the residency year, and any workplace whose type the new stage doesn't
   * offer.
   */
  const applyStage = (next: Stage) => {
    const opt = STAGE_BY_KEY[next];
    setForm((s) => ({
      ...s,
      stage: next,
      specialty_ids: opt.autoAttachesGeneralSpecialty
        ? generalSpecialtyId
          ? [generalSpecialtyId]
          : []
        : s.specialty_ids.filter((id) => id !== generalSpecialtyId),
      subspecialty: opt.showsSpecialtyPicker ? s.subspecialty : "",
      certificates: opt.showsCertificates ? s.certificates : [],
      residency_start_year: opt.requiresResidencyStartYear
        ? s.residency_start_year
        : "",
      // A row the doctor hasn't touched yet adopts the stage's default type
      // (عيادة for طب عام); a row they've already named only gets corrected
      // when the new stage doesn't offer its type at all.
      workplaces: s.workplaces.map((w) =>
        workplaceForStage(
          w.name.trim() === ""
            ? { ...w, workplace_type: opt.defaultWorkplaceType }
            : w,
          next,
        ),
      ),
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missing.length > 0) return;
    setError(null);
    setFieldErrors({});
    setRegistryName(null);
    setSubmitting(true);

    try {
      // Uniqueness is re-checked server-side in /signup/start, so we don't
      // need a separate /check-unique call here. Cuts one Turnstile-gated
      // round-trip and avoids the single-use token problem (each verified
      // token is consumed by Cloudflare; multiple calls per submit fail).

      // The MoH cross-check only covers the Israeli registry — PS-track
      // signups have nothing to check against, so they skip straight to
      // /start and land in admin review either way.
      let freshToken = turnstileToken;
      if (form.license_region === "IL") {
        // Step 1: license cross-check (skip silently on transient failures)
        const lic = await fetch("/api/signup/check-license", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            license_number: form.license_number,
            hebrew_first_name: form.hebrew_first_name,
            hebrew_family_name: form.hebrew_family_name,
            turnstile_token: turnstileToken,
          }),
        }).then((r) => r.json());

        if (lic?.status === "name_mismatch" && !overrideMismatch) {
          setRegistryName({
            first: lic.registry_first_name,
            family: lic.registry_family_name,
          });
          setFieldErrors({
            hebrew_full_name:
              "الاسم العبري لا يطابق سجل وزارة الصحة. تحقق من الكتابة كما تظهر على رخصتك.",
          });
          setSubmitting(false);
          return;
        }

        // Step 2: full submit. The Turnstile token was consumed by step 1, so
        // reset and wait for a fresh one before calling /start. With
        // appearance: "interaction-only" + passive checks, the new token
        // arrives in milliseconds without user interaction.
        turnstileRef.current?.reset();
        try {
          freshToken = (await turnstileRef.current?.getToken()) ?? "";
        } catch {
          setError("لم يكتمل التحقق من المتصفح. الرجاء إعادة المحاولة.");
          setSubmitting(false);
          return;
        }
      }

      const start = await fetch("/api/signup/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          // `stage` is a UI-only key; the column holds two values with طب عام
          // as NULL. JSON.stringify drops the undefined.
          stage: undefined,
          career_stage: form.stage
            ? STAGE_BY_KEY[form.stage].careerStage
            : null,
          residency_start_year: form.residency_start_year
            ? Number(form.residency_start_year)
            : null,
          workplaces: cleanWorkplaces(form.workplaces),
          secondary_license_region: form.has_secondary_license
            ? form.secondary_license_region
            : null,
          secondary_license_number: form.has_secondary_license
            ? form.secondary_license_number.trim()
            : null,
          override_name_mismatch: overrideMismatch,
          turnstile_token: freshToken,
        }),
      });
      // Parse defensively: a platform-level failure answers with an HTML
      // error page, which would otherwise throw as a connection error.
      const startBody = await start.json().catch(() => null);
      if (!start.ok) {
        // Reset Turnstile so the next retry has a fresh single-use token.
        turnstileRef.current?.reset();
        if (startBody?.fields) setFieldErrors(startBody.fields);
        setError(startBody?.error ?? "حدث خطأ. الرجاء المحاولة مجددًا.");
        setSubmitting(false);
        return;
      }

      // PII out of URL: hand off on the client between /signup and /verify.
      setHandoff(SS_PHONE, form.phone);
      setHandoff(SS_SESSION, startBody.signup_session_id);
      router.push("/verify?mode=signup");
    } catch (err) {
      console.error(err);
      setError("حدث خطأ أثناء الاتصال بالخادم.");
      setSubmitting(false);
    }
  };

  const fieldError = (k: string) => fieldErrors[k];

  const setRegion = (region: LicenseRegion) =>
    setForm((s) => ({
      ...s,
      license_region: region,
      secondary_license_region: OTHER_REGION[region],
    }));

  return (
    <form onSubmit={submit} className="flex flex-col gap-8 sm:gap-6">
      <p className="text-sm text-foreground/70">
        الحقول المشار إليها بـ
        <RequiredMark /> إلزامية.
      </p>

      <Section title="معلومات الاتصال والترخيص">
        <Field label="رقم الهاتف" htmlFor="phone" required error={fieldError("phone")}>
          <input
            id="phone"
            type="tel"
            required
            dir="ltr"
            autoComplete="tel"
            inputMode="tel"
            pattern="[0-9+\-\s()]*"
            className="input"
            value={form.phone}
            onChange={(e) => update("phone", cleanPhone(e.target.value))}
            placeholder="0501234567"
          />
        </Field>

        <Field label="جهة الترخيص" required>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="license_region"
                checked={form.license_region === "IL"}
                onChange={() => setRegion("IL")}
              />
              <span>ترخيص إسرائيلي (وزارة الصحة)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="license_region"
                checked={form.license_region === "PS"}
                onChange={() => setRegion("PS")}
              />
              <span>ترخيص فلسطيني (نقابة الأطباء / وزارة الصحة)</span>
            </label>
          </div>
          {form.license_region === "PS" && (
            <p className="mt-2 text-sm text-foreground/65">
              لا يوجد سجل إلكتروني يمكننا مطابقته آليًا لهذا النوع من
              التراخيص حاليًا، لذا ستتم مراجعة طلبك يدويًا من قبل الإدارة قبل
              التفعيل.
            </p>
          )}
        </Field>

        <Field
          label="رقم الترخيص"
          htmlFor="license_number"
          required
          error={fieldError("license_number")}
        >
          <input
            id="license_number"
            required
            dir="ltr"
            inputMode={form.license_region === "IL" ? "numeric" : "text"}
            pattern={form.license_region === "IL" ? "[0-9-]*" : undefined}
            className="input"
            placeholder={form.license_region === "IL" ? "189371" : undefined}
            value={form.license_number}
            onChange={(e) =>
              update("license_number", cleanLicense(form.license_region, e.target.value))
            }
          />
        </Field>

        <Field
          label="ترخيص إضافي"
          htmlFor="secondary_license_number"
          required={form.has_secondary_license}
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.has_secondary_license}
              onChange={(e) => update("has_secondary_license", e.target.checked)}
            />
            <span>
              لديّ أيضًا ترخيص من الجهة الأخرى ({" "}
              {OTHER_REGION[form.license_region] === "IL" ? "إسرائيلي" : "فلسطيني"} )
            </span>
          </label>
          {form.has_secondary_license && (
            <input
              id="secondary_license_number"
              required
              dir="ltr"
              className="input mt-2"
              inputMode={
                form.secondary_license_region === "IL" ? "numeric" : "text"
              }
              value={form.secondary_license_number}
              onChange={(e) =>
                update(
                  "secondary_license_number",
                  cleanLicense(form.secondary_license_region, e.target.value),
                )
              }
              placeholder={
                form.secondary_license_region === "IL"
                  ? "رقم الترخيص الإسرائيلي، مثل 189371"
                  : "رقم الترخيص الفلسطيني"
              }
            />
          )}
          {fieldError("secondary_license_number") && (
            <p className="mt-1 text-sm text-red-600">
              {fieldError("secondary_license_number")}
            </p>
          )}
        </Field>

        <Field label="البريد الإلكتروني" htmlFor="email" required error={fieldError("email")}>
          <input
            id="email"
            type="email"
            required
            dir="ltr"
            autoComplete="email"
            className="input"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="الاسم">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="arabic_first_name"
            label="الاسم بالعربية"
            required
            value={form.arabic_first_name}
            onChange={(v) => update("arabic_first_name", v)}
            error={fieldError("arabic_first_name")}
          />
          <TextField
            id="arabic_family_name"
            label="اسم العائلة بالعربية"
            required
            value={form.arabic_family_name}
            onChange={(v) => update("arabic_family_name", v)}
            error={fieldError("arabic_family_name")}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="hebrew_first_name"
            label={hebrewRequired ? "الاسم بالعبرية" : "الاسم بالعبرية (اختياري)"}
            required={hebrewRequired}
            dir="auto"
            value={form.hebrew_first_name}
            onChange={(v) => update("hebrew_first_name", v)}
            error={fieldError("hebrew_first_name")}
          />
          <TextField
            id="hebrew_family_name"
            label={
              hebrewRequired ? "اسم العائلة بالعبرية" : "اسم العائلة بالعبرية (اختياري)"
            }
            required={hebrewRequired}
            dir="auto"
            value={form.hebrew_family_name}
            onChange={(v) => update("hebrew_family_name", v)}
            error={fieldError("hebrew_family_name")}
          />
        </div>
        {hebrewRequired && (
          <p className="text-sm text-foreground/65">
            نستخدم الاسم بالعبرية فقط لمطابقة رقم الترخيص مع سجل وزارة الصحة
            الإسرائيلية.
          </p>
        )}

        {fieldError("hebrew_full_name") && (
          <p className="text-sm text-red-600">{fieldError("hebrew_full_name")}</p>
        )}

        {registryName && (
          <div className="rounded border border-amber-300 bg-amber-50 p-4 text-base">
            <p className="mb-2">
              الاسم في سجل وزارة الصحة لرقم الترخيص هذا هو:{" "}
              <strong dir="auto">
                {registryName.first} {registryName.family}
              </strong>
              .
            </p>
            <p className="mb-2">
              إذا كنت متأكدًا أنك أنت، يمكنك المتابعة وسيتم مراجعة طلبك من قبل
              الإدارة قبل تفعيل الحساب.
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={overrideMismatch}
                onChange={(e) => setOverrideMismatch(e.target.checked)}
              />
              <span>أؤكد أن هذا حسابي وأطلب المراجعة اليدوية</span>
            </label>
          </div>
        )}
      </Section>

      <Section title="المرحلة المهنية">
        <Field label="اختر ما ينطبق عليك" required error={fieldError("career_stage")}>
          <div id="stage" tabIndex={-1} className="flex flex-col gap-2">
            {STAGE_OPTIONS.map((o) => (
              <label key={o.stage} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="stage"
                  className="mt-1"
                  checked={form.stage === o.stage}
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
        </Field>

        {stageOpt?.requiresResidencyStartYear && (
          <Field
            label="سنة بداية التخصص"
            htmlFor="residency_start_year"
            required
            error={fieldError("residency_start_year")}
          >
            <input
              id="residency_start_year"
              className="input"
              type="number"
              inputMode="numeric"
              dir="ltr"
              required
              min={RESIDENCY_YEAR_MIN}
              max={residencyYearMax()}
              value={form.residency_start_year}
              onChange={(e) => update("residency_start_year", e.target.value)}
              placeholder={String(residencyYearMax())}
            />
          </Field>
        )}

        <SeekingWorkCheckbox
          checked={form.seeking_work}
          onChange={(v) => update("seeking_work", v)}
        />
      </Section>

      {stageOpt?.showsCertificates && (
        <Section title="شهادات إضافية (اختياري)">
          <Field
            label="تظهر على بطاقتك بدل «الطب العام»"
            htmlFor="certificates"
          >
            <CertificatesEditor
              id="certificates"
              value={form.certificates}
              onChange={(v) => update("certificates", v)}
            />
          </Field>
        </Section>
      )}

      {showSpecialtyPicker && (
        <Section title="التخصص">
          <Field
            label="التخصص (اختر واحدًا أو أكثر)"
            required
            error={fieldError("specialty_ids")}
          >
            <SpecialtyPicker
              id="specialty_ids"
              specialties={visibleSpecialties}
              selected={form.specialty_ids}
              onChange={(ids) => update("specialty_ids", ids)}
            />
          </Field>

          <TextField
            id="subspecialty"
            label="التخصص الدقيق أو مجال الاهتمام (اختياري)"
            value={form.subspecialty}
            onChange={(v) => update("subspecialty", v)}
            placeholder="مثلاً: جراحة اليد"
          />
        </Section>
      )}

      <Section title="نبذة عني (اختياري)">
        <Field
          label="اكتب ما تريد زملاءك أن يعرفوه عنك — خبرة، اهتمامات مهنية، أو أي شيء آخر"
          htmlFor="bio"
        >
          <textarea
            id="bio"
            className="input"
            rows={3}
            maxLength={500}
            value={form.bio}
            onChange={(e) => update("bio", e.target.value)}
            placeholder="مثلاً: خبرة عملية واسعة في هذا المجال رغم عدم الحصول على شهادة تخصص رسمية بعد"
          />
        </Field>
      </Section>

      {stageOpt && (
        <Section
          title={stageOpt.workplaceOptional ? "مكان التدريب الحالي (اختياري)" : "مكان العمل"}
          required={!stageOpt.workplaceOptional}
        >
          {stageOpt.workplaceOptional && (
            <p className="text-sm text-foreground/65">
              يمكنك تركه فارغًا إذا كنت تتنقل بين الأقسام أو المستشفيات خلال
              التخصص، وتعديله لاحقًا من ملفك.
            </p>
          )}
          <WorkplaceEditor
            workplaces={form.workplaces}
            onChange={(next) => update("workplaces", next)}
            stage={form.stage}
          />
          {fieldError("workplaces") && (
            <p className="mt-1 text-sm text-red-600">{fieldError("workplaces")}</p>
          )}
        </Section>
      )}

      <Section title="الموافقة" required>
        <div className="rounded border border-foreground/15 bg-foreground/5 p-4 text-base leading-relaxed">
          <p>
            المعلومات التي أدخلتها — الاسم، رقم الهاتف، رقم الترخيص،
            التخصصات، وأماكن العمل — ستُستخدم داخل المنصة لمساعدة زملائك من
            الأطباء المسجلين على إيجادك والتواصل معك مهنيًا، ولأي استخدامات
            تخدم تطوير المنصة أو توسيع شبكة التواصل.
          </p>
        </div>

        <label className="flex items-start gap-3 rounded border border-foreground/15 p-3 text-base">
          <input
            id="consent"
            type="checkbox"
            required
            checked={form.consent}
            onChange={(e) => update("consent", e.target.checked)}
            className="mt-1"
          />
          <span>
            أوافق على ما ورد أعلاه، وأؤكد أنني طبيب وأن المعلومات المدخلة
            صحيحة، وأوافق على استخدامها.
          </span>
        </label>
      </Section>

      <TurnstileWidget
        ref={turnstileRef}
        onToken={handleTurnstileToken}
        action="signup"
      />

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <MissingFieldsNotice missing={missing} />

      <button
        type="submit"
        disabled={submitting || missing.length > 0}
        className="w-full rounded-md bg-foreground px-6 py-3 text-background disabled:opacity-50"
      >
        {submitting
          ? "جارٍ الإرسال..."
          : "تسجيل وإرسال رمز التحقق برسالة نصية"}
      </button>

      <p className="text-center text-base text-foreground/70">
        لديك حساب بالفعل؟{" "}
        <a className="underline" href="/login">
          تسجيل الدخول
        </a>
      </p>

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
  required,
  children,
}: {
  title: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-foreground/15 p-5 space-y-4">
      <h2 className="border-b border-foreground/10 pb-2 text-lg font-bold">
        {title}
        {required && <RequiredMark />}
      </h2>
      {children}
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  required,
  error,
  dir,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  dir?: "auto";
  placeholder?: string;
}) {
  return (
    <Field label={label} htmlFor={id} required={required} error={error}>
      <input
        id={id}
        required={required}
        dir={dir}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
