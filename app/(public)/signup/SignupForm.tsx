"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/components/TurnstileWidget";

type Specialty = { id: string; name_ar: string };
type LicenseRegion = "IL" | "PS";
type WorkplaceType = "hospital" | "clinic";
type WorkplaceEntry = {
  name: string;
  workplace_type: WorkplaceType;
  details: string;
  is_primary: boolean;
};

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
  specialty_ids: string[];
  subspecialty: string;
  email: string;
  bio: string;
  workplaces: WorkplaceEntry[];
  consent: boolean;
};

const EMPTY_WORKPLACE = (isPrimary: boolean): WorkplaceEntry => ({
  name: "",
  workplace_type: "hospital",
  details: "",
  is_primary: isPrimary,
});

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
  specialty_ids: [],
  subspecialty: "",
  email: "",
  bio: "",
  workplaces: [EMPTY_WORKPLACE(true)],
  consent: false,
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

  const toggleSpecialty = (id: string) =>
    setForm((s) => ({
      ...s,
      specialty_ids: s.specialty_ids.includes(id)
        ? s.specialty_ids.filter((x) => x !== id)
        : [...s.specialty_ids, id],
    }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setRegistryName(null);
    setSubmitting(true);

    const cleanedWorkplaces = form.workplaces
      .map((w) => ({ ...w, name: w.name.trim(), details: w.details.trim() }))
      .filter((w) => w.name.length > 0);

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
          workplaces: cleanedWorkplaces,
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
      const startBody = await start.json();
      if (!start.ok) {
        // Reset Turnstile so the next retry has a fresh single-use token.
        turnstileRef.current?.reset();
        if (startBody?.fields) setFieldErrors(startBody.fields);
        setError(startBody?.error ?? "حدث خطأ. الرجاء المحاولة مجددًا.");
        setSubmitting(false);
        return;
      }

      // PII out of URL: stash on the client between /signup and /verify.
      sessionStorage.setItem("verify:phone", form.phone);
      sessionStorage.setItem(
        "verify:signup_session",
        startBody.signup_session_id,
      );
      router.push("/verify?mode=signup");
    } catch (err) {
      console.error(err);
      setError("حدث خطأ أثناء الاتصال بالخادم.");
      setSubmitting(false);
    }
  };

  const fieldError = (k: string) => fieldErrors[k];

  const needsHebrewName =
    form.license_region === "IL" ||
    (form.has_secondary_license && form.secondary_license_region === "IL");

  // Strip disallowed chars from phone + license inputs so a paste of
  // "Phone: 050-1234567" still produces a clean digit string. Server-side
  // normalization is the actual source of truth.
  const onPhoneChange = (next: string) => {
    update("phone", next.replace(/[^0-9+\-\s()]/g, ""));
  };
  // PS licenses have no confirmed public format, so we only strip characters
  // that would break the request — IL stays digits-only.
  const onLicenseChange = (next: string) => {
    update(
      "license_number",
      form.license_region === "IL"
        ? next.replace(/\D/g, "")
        : next.replace(/[,()]/g, ""),
    );
  };

  const setWorkplacePrimary = (i: number) =>
    setForm((s) => ({
      ...s,
      workplaces: s.workplaces.map((w, j) => ({ ...w, is_primary: j === i })),
    }));
  const updateWorkplace = (i: number, patch: Partial<WorkplaceEntry>) =>
    setForm((s) => ({
      ...s,
      workplaces: s.workplaces.map((w, j) =>
        j === i ? { ...w, ...patch } : w,
      ),
    }));
  const addWorkplace = () =>
    setForm((s) => ({
      ...s,
      workplaces: [...s.workplaces, EMPTY_WORKPLACE(false)],
    }));
  const removeWorkplace = (i: number) =>
    setForm((s) => {
      const next = s.workplaces.filter((_, j) => j !== i);
      if (next.length === 0) return { ...s, workplaces: [EMPTY_WORKPLACE(true)] };
      if (!next.some((w) => w.is_primary)) next[0] = { ...next[0]!, is_primary: true };
      return { ...s, workplaces: next };
    });

  return (
    <form onSubmit={submit} className="flex flex-col gap-8 sm:gap-6">
      <Section title="معلومات الاتصال والترخيص">
        <Field label="رقم الهاتف" error={fieldError("phone")}>
          <input
            type="tel"
            required
            dir="ltr"
            autoComplete="tel"
            inputMode="tel"
            pattern="[0-9+\-\s()]*"
            className="input"
            value={form.phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="0501234567"
          />
        </Field>

        <Field label="جهة الترخيص">
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="license_region"
                checked={form.license_region === "IL"}
                onChange={() =>
                  setForm((s) => ({
                    ...s,
                    license_region: "IL",
                    secondary_license_region: "PS",
                  }))
                }
              />
              <span>ترخيص إسرائيلي (وزارة الصحة)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="license_region"
                checked={form.license_region === "PS"}
                onChange={() =>
                  setForm((s) => ({
                    ...s,
                    license_region: "PS",
                    secondary_license_region: "IL",
                  }))
                }
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

        <Field label="رقم الترخيص (المعرف الطبي)" error={fieldError("license_number")}>
          <input
            required
            dir="ltr"
            inputMode={form.license_region === "IL" ? "numeric" : "text"}
            pattern={form.license_region === "IL" ? "\\d*" : undefined}
            className="input"
            value={form.license_number}
            onChange={(e) => onLicenseChange(e.target.value)}
          />
        </Field>

        <Field label="ترخيص إضافي">
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
                  form.secondary_license_region === "IL"
                    ? e.target.value.replace(/\D/g, "")
                    : e.target.value.replace(/[,()]/g, ""),
                )
              }
              placeholder={
                form.secondary_license_region === "IL"
                  ? "رقم الترخيص الإسرائيلي"
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

        <Field label="البريد الإلكتروني" error={fieldError("email")}>
          <input
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
          <Field label="الاسم بالعربية" error={fieldError("arabic_first_name")}>
            <input
              required
              className="input"
              value={form.arabic_first_name}
              onChange={(e) => update("arabic_first_name", e.target.value)}
            />
          </Field>
          <Field label="اسم العائلة بالعربية" error={fieldError("arabic_family_name")}>
            <input
              required
              className="input"
              value={form.arabic_family_name}
              onChange={(e) => update("arabic_family_name", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={
              needsHebrewName ? "الاسم بالعبرية" : "الاسم بالعبرية (اختياري)"
            }
            error={fieldError("hebrew_first_name")}
          >
            <input
              required={needsHebrewName}
              dir="auto"
              className="input"
              value={form.hebrew_first_name}
              onChange={(e) => update("hebrew_first_name", e.target.value)}
            />
          </Field>
          <Field
            label={
              needsHebrewName
                ? "اسم العائلة بالعبرية"
                : "اسم العائلة بالعبرية (اختياري)"
            }
            error={fieldError("hebrew_family_name")}
          >
            <input
              required={needsHebrewName}
              dir="auto"
              className="input"
              value={form.hebrew_family_name}
              onChange={(e) => update("hebrew_family_name", e.target.value)}
            />
          </Field>
        </div>
        {needsHebrewName && (
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

      <Section title="التخصص">
        <Field label="التخصص (اختر واحدًا أو أكثر)" error={fieldError("specialty_ids")}>
          <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded border border-foreground/15 p-2 sm:grid-cols-2">
            {specialties.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-2 rounded p-1 hover:bg-foreground/5"
              >
                <input
                  type="checkbox"
                  checked={form.specialty_ids.includes(s.id)}
                  onChange={() => toggleSpecialty(s.id)}
                  disabled={
                    !form.specialty_ids.includes(s.id) &&
                    form.specialty_ids.length >= 5
                  }
                />
                <span>{s.name_ar}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="التخصص الفرعي (اختياري)">
          <input
            className="input"
            value={form.subspecialty}
            onChange={(e) => update("subspecialty", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="نبذة عني (اختياري)">
        <Field label="اكتب ما تريد زملاءك أن يعرفوه عنك — خبرة، اهتمامات مهنية، أو أي شيء آخر">
          <textarea
            className="input"
            rows={3}
            maxLength={500}
            value={form.bio}
            onChange={(e) => update("bio", e.target.value)}
            placeholder="مثلاً: خبرة عملية واسعة في هذا المجال رغم عدم الحصول على شهادة تخصص رسمية بعد"
          />
        </Field>
      </Section>

      <Section title="مكان العمل">
        <div className="space-y-4">
          {form.workplaces.map((wp, i) => (
            <div
              key={i}
              className="space-y-2 rounded border border-foreground/15 p-3"
            >
              <div className="flex gap-2">
                <input
                  required={i === 0}
                  className="input flex-1"
                  value={wp.name}
                  onChange={(e) => updateWorkplace(i, { name: e.target.value })}
                  placeholder="مثلاً: مستشفى هداسا عين كارم"
                />
                {form.workplaces.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeWorkplace(i)}
                    className="shrink-0 rounded border border-foreground/20 px-3 text-base hover:bg-foreground/5"
                    aria-label="حذف مكان العمل"
                  >
                    حذف
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`workplace_type_${i}`}
                    checked={wp.workplace_type === "hospital"}
                    onChange={() =>
                      updateWorkplace(i, { workplace_type: "hospital" })
                    }
                  />
                  مستشفى
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`workplace_type_${i}`}
                    checked={wp.workplace_type === "clinic"}
                    onChange={() =>
                      updateWorkplace(i, { workplace_type: "clinic" })
                    }
                  />
                  عيادة خاصة
                </label>
                {form.workplaces.length > 1 && (
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="workplace_primary"
                      checked={wp.is_primary}
                      onChange={() => setWorkplacePrimary(i)}
                    />
                    مكان العمل الرئيسي
                  </label>
                )}
              </div>

              {wp.workplace_type === "clinic" && (
                <input
                  className="input"
                  value={wp.details}
                  onChange={(e) =>
                    updateWorkplace(i, { details: e.target.value })
                  }
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
            + إضافة مكان عمل آخر
          </button>
        </div>
        {fieldError("workplaces") && (
          <p className="mt-1 text-sm text-red-600">{fieldError("workplaces")}</p>
        )}
      </Section>

      <Section title="الموافقة">
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

      <button
        type="submit"
        disabled={
          submitting ||
          form.specialty_ids.length === 0 ||
          !form.workplaces.some((w) => w.name.trim()) ||
          !form.email.trim() ||
          !form.consent ||
          (form.has_secondary_license && !form.secondary_license_number.trim())
        }
        className="w-full rounded-md bg-foreground px-6 py-3 text-background disabled:opacity-50"
      >
        {submitting
          ? "جارٍ الإرسال..."
          : "تسجيل وإرسال رمز التحقق عبر رسالة نصية"}
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-foreground/15 p-5 space-y-4">
      <h2 className="border-b border-foreground/10 pb-2 text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-base font-medium">{label}</label>
      {children}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
