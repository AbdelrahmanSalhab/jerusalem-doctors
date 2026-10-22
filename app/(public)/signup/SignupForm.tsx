"use client";

import { apiErrorMessage, fieldErrorMessage } from "@/lib/client/apiError";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { Field, RequiredMark, RetiredCheckbox, SeekingWorkCheckbox } from "@/components/FormField";
import { CertificatesEditor } from "@/components/CertificatesEditor";
import { InputStyles } from "@/components/InputStyles";
import { SpecialtyPicker } from "@/components/SpecialtyPicker";
import { StageRadios } from "@/components/StageRadios";
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
  type Stage,
} from "@/lib/careerStage";
import {
  SS_PHONE,
  SS_SESSION,
  setHandoff,
} from "@/lib/client/verify_handoff";
import {
  applyStage as applyStageTo,
  buildStartBody,
  type FormState,
  INITIAL,
  type LicenseRegion,
  OTHER_REGION,
} from "@/lib/signup/formState";
import { getMissingFields, needsHebrewName } from "@/lib/signup/missingFields";
import { firstStepOf, SIGNUP_STEPS, stepOfField } from "@/lib/signup/steps";
import type { SpecialtyNode } from "@/lib/specialtyTree";
import { ConsentSection } from "./ConsentSection";
import { LicenseSection } from "./LicenseSection";
import { MissingFieldsNotice } from "./MissingFieldsNotice";
import { NameSection } from "./NameSection";
import { Section, TextField } from "./SignupFields";

type Specialty = SpecialtyNode & { code: string | null };

export function SignupForm({ specialties }: { specialties: Specialty[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const goTo = (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  /** Field errors from the server, shown on the step that holds them. */
  const showFieldErrors = (fields: Record<string, string>) => {
    setFieldErrors(fields);
    const s = firstStepOf(Object.keys(fields));
    if (s !== null) goTo(s);
  };
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
  // Either flag on its own excuses the workplace, and they are independent:
  // a retired doctor may still be looking for locum work.
  const workplaceOptional = form.seeking_work || form.retired;
  // A طب عام signup posts the الطب العام specialty on the doctor's behalf.
  // If that row has been deactivated from /admin/specialties there is nothing
  // to attach, and a silently empty specialty_ids would leave submit disabled
  // with no explanation, so fall back to showing the normal picker.
  const showSpecialtyPicker =
    !!stageOpt &&
    (stageOpt.showsSpecialtyPicker ||
      (stageOpt.autoAttachesGeneralSpecialty && !generalSpecialtyId));
  const visibleSpecialties =
    stageOpt?.excludesGeneralSpecialty && generalSpecialtyId
      ? specialties.filter((s) => s.id !== generalSpecialtyId)
      : specialties;

  const missing = getMissingFields(form);
  const missingHere = missing.filter((m) => stepOfField(m.key) === step);
  const lastStep = step === SIGNUP_STEPS.length - 1;
  const hebrewRequired = needsHebrewName(form);

  const applyStage = (next: Stage) =>
    setForm((s) => applyStageTo(s, next, generalSpecialtyId));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Enter on an earlier step moves on rather than submitting.
    if (!lastStep) {
      if (missingHere.length === 0) goTo(step + 1);
      return;
    }
    if (missing.length > 0) return;
    setError(null);
    setFieldErrors({});
    setRegistryName(null);
    setSubmitting(true);

    try {
      // Uniqueness is checked server-side in /signup/start, not in a call
      // of its own: each Turnstile token is single-use, so a second
      // Turnstile-gated call per submit would fail.

      // The MoH cross-check only covers the Israeli registry, PS-track
      // signups have nothing to check against, so they skip straight to
      // /start and land in admin review either way.
      // The check starts when the last step appears, so a quick submit can
      // arrive before its token; wait for it rather than send an empty one.
      let freshToken = turnstileToken;
      if (!freshToken) {
        try {
          freshToken = (await turnstileRef.current?.getToken(15_000)) ?? "";
        } catch {
          setError("لم يكتمل التحقق من المتصفح. تأكد من الاتصال وأعد المحاولة.");
          setSubmitting(false);
          return;
        }
      }
      if (form.license_region === "IL") {
        // Step 1: license cross-check (skip silently on transient failures)
        const lic = await fetch("/api/signup/check-license", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            license_number: form.license_number,
            hebrew_first_name: form.hebrew_first_name,
            hebrew_family_name: form.hebrew_family_name,
            turnstile_token: freshToken,
          }),
        }).then((r) => r.json());

        if (lic?.status === "name_mismatch" && !overrideMismatch) {
          setRegistryName({
            first: lic.registry_first_name,
            family: lic.registry_family_name,
          });
          showFieldErrors({
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
        body: JSON.stringify(buildStartBody(form, overrideMismatch, freshToken)),
      });
      // Parse defensively: a platform-level failure answers with an HTML
      // error page, which would otherwise throw as a connection error.
      const startBody = await start.json().catch(() => null);
      if (!start.ok) {
        // Reset Turnstile so the next retry has a fresh single-use token.
        turnstileRef.current?.reset();
        if (startBody?.fields) showFieldErrors(startBody.fields);
        setError(fieldErrorMessage(startBody?.fields) ?? apiErrorMessage(startBody?.code));
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
      <StepProgress step={step} />
      <p className="text-sm text-muted">
        الحقول المشار إليها بـ
        <RequiredMark /> إلزامية.
      </p>

      {step === 0 && (
        <LicenseSection
          form={form}
          update={update}
          setRegion={setRegion}
          fieldError={fieldError}
        />
      )}

      {step === 1 && (
        <NameSection
          form={form}
          update={update}
          hebrewRequired={hebrewRequired}
          fieldError={fieldError}
          registryName={registryName}
          overrideMismatch={overrideMismatch}
          setOverrideMismatch={setOverrideMismatch}
        />
      )}

      {lastStep && (
        <>
        <Section title="المرحلة المهنية">
          <Field label="اختر ما ينطبق عليك" required error={fieldError("career_stage")}>
            <StageRadios id="stage" value={form.stage} onChange={applyStage} />
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

          <RetiredCheckbox
            checked={form.retired}
            onChange={(v) => update("retired", v)}
          />
        </Section>

        {stageOpt?.showsCertificates && (
          <Section title="الخدمات والشهادات (اختياري)">
            <Field
              label={form.stage === "general" ? "شهادات وخدمات (تظهر على بطاقتك بدل «الطب العام»)" : "الخدمات والإجراءات التي تقدّمها، مثلًا: تنظير القولون، حقن العين"}
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
          label="اكتب ما تريد زملاءك أن يعرفوه عنك: خبرة، اهتمامات مهنية، أو أي شيء آخر"
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
          title={
            stageOpt.workplaceOptional
              ? "مكان التدريب الحالي (اختياري)"
              : workplaceOptional
                ? "مكان العمل (اختياري)"
                : "مكان العمل"
          }
          required={!stageOpt.workplaceOptional && !workplaceOptional}
        >
          {stageOpt.workplaceOptional && (
            <p className="text-sm text-foreground/65">
              يمكنك تركه فارغًا إذا كنت تتنقل بين الأقسام أو المستشفيات خلال
              التخصص، وتعديله لاحقًا من ملفك.
            </p>
          )}
          {!stageOpt.workplaceOptional && form.retired && (
            <p className="text-sm text-foreground/65">
              يمكنك تركه فارغًا بعد التقاعد، أو إضافة مكان عملك السابق إن أردت.
            </p>
          )}
          {!stageOpt.workplaceOptional && !form.retired && form.seeking_work && (
            <p className="text-sm text-foreground/65">
              يمكنك تركه فارغًا ما دمت تبحث عن عمل، وإضافته من ملفك حين تبدأ.
            </p>
          )}
          <WorkplaceEditor
            workplaces={form.workplaces}
            onChange={(next) => update("workplaces", next)}
            stage={form.stage}
            optional={workplaceOptional}
          />
          {fieldError("workplaces") && (
            <p className="mt-1 text-sm text-danger">{fieldError("workplaces")}</p>
          )}
        </Section>
      )}

      <ConsentSection
        checked={form.consent}
        onChange={(v) => update("consent", v)}
      />

      <TurnstileWidget
        ref={turnstileRef}
        onToken={handleTurnstileToken}
        action="signup"
      />
      </>
      )}

      {error && (
        <p role="alert" className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
          {error}
        </p>
      )}

      <MissingFieldsNotice missing={missingHere} />

      <div className="flex gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => goTo(step - 1)}
            className="rounded-md border border-line bg-surface px-5 py-3 hover:bg-foreground/5"
          >
            رجوع
          </button>
        )}
        <button
          type="submit"
          disabled={submitting || missingHere.length > 0}
          className="flex-1 rounded-md bg-primary px-6 py-3 font-semibold text-primary-fg disabled:opacity-50"
        >
          {!lastStep
            ? "التالي"
            : submitting
              ? "جارٍ الإرسال..."
              : "تسجيل وإرسال رمز التحقق برسالة نصية"}
        </button>
      </div>

      <p className="text-center text-base text-foreground/70">
        لديك حساب بالفعل؟{" "}
        <a className="underline" href="/login">
          تسجيل الدخول
        </a>
      </p>

      <InputStyles />
    </form>
  );
}

/** "الخطوة 2 من 3" with the three step names, the current one marked. */
function StepProgress({ step }: { step: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        الخطوة {step + 1} من {SIGNUP_STEPS.length}
      </p>
      <ol className="grid grid-cols-3 gap-2" aria-label="خطوات التسجيل">
        {SIGNUP_STEPS.map((name, i) => (
          <li key={name} aria-current={i === step ? "step" : undefined} className="flex flex-col gap-1.5">
            <span className={"h-1.5 rounded-full " + (i <= step ? "bg-primary" : "bg-line")} />
            <span className={"text-xs " + (i === step ? "font-semibold text-foreground" : "text-muted")}>{name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
