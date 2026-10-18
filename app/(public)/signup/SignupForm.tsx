"use client";

import { apiErrorMessage, fieldErrorMessage } from "@/lib/client/apiError";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { Field, RequiredMark, SeekingWorkCheckbox } from "@/components/FormField";
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

  const applyStage = (next: Stage) =>
    setForm((s) => applyStageTo(s, next, generalSpecialtyId));

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
        body: JSON.stringify(buildStartBody(form, overrideMismatch, freshToken)),
      });
      // Parse defensively: a platform-level failure answers with an HTML
      // error page, which would otherwise throw as a connection error.
      const startBody = await start.json().catch(() => null);
      if (!start.ok) {
        // Reset Turnstile so the next retry has a fresh single-use token.
        turnstileRef.current?.reset();
        if (startBody?.fields) setFieldErrors(startBody.fields);
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
      <p className="text-sm text-foreground/70">
        الحقول المشار إليها بـ
        <RequiredMark /> إلزامية.
      </p>

      <LicenseSection
        form={form}
        update={update}
        setRegion={setRegion}
        fieldError={fieldError}
      />

      <NameSection
        form={form}
        update={update}
        hebrewRequired={hebrewRequired}
        fieldError={fieldError}
        registryName={registryName}
        overrideMismatch={overrideMismatch}
        setOverrideMismatch={setOverrideMismatch}
      />

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

      <ConsentSection
        checked={form.consent}
        onChange={(v) => update("consent", v)}
      />

      <TurnstileWidget
        ref={turnstileRef}
        onToken={handleTurnstileToken}
        action="signup"
      />

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
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

      <InputStyles />
    </form>
  );
}
