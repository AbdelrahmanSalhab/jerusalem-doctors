"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";

type Specialty = { id: string; name_ar: string };

type FormState = {
  phone: string;
  license_number: string;
  arabic_first_name: string;
  arabic_family_name: string;
  hebrew_first_name: string;
  hebrew_family_name: string;
  specialty_ids: string[];
  subspecialty: string;
  email: string;
  main_workplace: string;
  other_workplaces: string[];
  consent: boolean;
};

const INITIAL: FormState = {
  phone: "",
  license_number: "",
  arabic_first_name: "",
  arabic_family_name: "",
  hebrew_first_name: "",
  hebrew_family_name: "",
  specialty_ids: [],
  subspecialty: "",
  email: "",
  main_workplace: "",
  other_workplaces: [],
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

    try {
      // Step 1: uniqueness
      const uniq = await fetch("/api/signup/check-unique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: form.phone,
          license_number: form.license_number,
        }),
      }).then((r) => r.json());
      if (uniq?.duplicate_field === "phone") {
        setFieldErrors({ phone: "رقم الهاتف مُسجّل مسبقًا. الرجاء تسجيل الدخول." });
        setSubmitting(false);
        return;
      }
      if (uniq?.duplicate_field === "license_number") {
        setFieldErrors({
          license_number:
            "رقم الترخيص مُسجّل مسبقًا. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.",
        });
        setSubmitting(false);
        return;
      }

      // Step 2: license cross-check (skip silently on transient failures)
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

      if (
        lic?.status === "name_mismatch" &&
        !overrideMismatch
      ) {
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

      // Step 3: full submit
      const start = await fetch("/api/signup/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          override_name_mismatch: overrideMismatch,
          turnstile_token: turnstileToken,
        }),
      });
      const startBody = await start.json();
      if (!start.ok) {
        if (startBody?.fields) setFieldErrors(startBody.fields);
        setError(startBody?.error ?? "حدث خطأ. الرجاء المحاولة مجددًا.");
        setSubmitting(false);
        return;
      }

      const params = new URLSearchParams({
        session: startBody.signup_session_id,
        phone: form.phone,
      });
      router.push(`/verify?${params.toString()}`);
    } catch (err) {
      console.error(err);
      setError("حدث خطأ أثناء الاتصال بالخادم.");
      setSubmitting(false);
    }
  };

  const fieldError = (k: string) => fieldErrors[k];

  return (
    <form onSubmit={submit} className="flex flex-col gap-8 sm:gap-6">
      <Section title="معلومات الاتصال والترخيص">
        <Field label="رقم الهاتف" error={fieldError("phone")}>
          <input
            type="tel"
            required
            dir="ltr"
            autoComplete="tel"
            className="input"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="0501234567"
          />
        </Field>

        <Field label="رقم الترخيص (المعرف الطبي)" error={fieldError("license_number")}>
          <input
            required
            dir="ltr"
            inputMode="numeric"
            className="input"
            value={form.license_number}
            onChange={(e) => update("license_number", e.target.value)}
          />
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
          <Field label="الاسم بالعبرية" error={fieldError("hebrew_first_name")}>
            <input
              required
              dir="auto"
              className="input"
              value={form.hebrew_first_name}
              onChange={(e) => update("hebrew_first_name", e.target.value)}
            />
          </Field>
          <Field label="اسم العائلة بالعبرية" error={fieldError("hebrew_family_name")}>
            <input
              required
              dir="auto"
              className="input"
              value={form.hebrew_family_name}
              onChange={(e) => update("hebrew_family_name", e.target.value)}
            />
          </Field>
        </div>

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

      <Section title="مكان العمل">
        <Field label="مكان العمل الرئيسي" error={fieldError("main_workplace")}>
          <input
            required
            className="input"
            value={form.main_workplace}
            onChange={(e) => update("main_workplace", e.target.value)}
            placeholder="مثلاً: مستشفى هداسا عين كارم"
          />
        </Field>

        <Field label="أماكن عمل أخرى (اختياري)">
          <div className="space-y-2">
            {form.other_workplaces.map((wp, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input flex-1"
                  value={wp}
                  onChange={(e) => {
                    const next = [...form.other_workplaces];
                    next[i] = e.target.value;
                    update("other_workplaces", next);
                  }}
                  placeholder="اسم العيادة أو المستشفى"
                />
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "other_workplaces",
                      form.other_workplaces.filter((_, x) => x !== i),
                    )
                  }
                  className="rounded border border-foreground/20 px-3 text-base hover:bg-foreground/5"
                  aria-label="حذف مكان العمل"
                >
                  حذف
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                update("other_workplaces", [...form.other_workplaces, ""])
              }
              className="rounded border border-dashed border-foreground/30 px-4 py-2 text-base text-foreground/80 hover:bg-foreground/5"
            >
              + إضافة مكان عمل آخر
            </button>
          </div>
        </Field>
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

      <TurnstileWidget onToken={handleTurnstileToken} action="signup" />

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
          !form.main_workplace.trim() ||
          !form.email.trim() ||
          !form.consent
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
