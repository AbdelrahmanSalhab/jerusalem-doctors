"use client";

// The second factor of an admin's password sign-in (#164, lib/auth/mfa.ts):
// an authenticator app on their phone, enrolled here once. Until the code is
// confirmed the factor does not count, so a QR that was scanned wrongly
// locks nobody out.

import { useEffect, useState } from "react";
import { Section } from "./ProfileFields";

type Step =
  | { name: "loading" }
  | { name: "on" }
  | { name: "off" }
  | { name: "unknown" }
  | { name: "scan"; factorId: string; qr: string; secret: string };

export function MfaSection() {
  const [step, setStep] = useState<Step>({ name: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/mfa")
      .then(async (res) => (res.ok ? setStep((await res.json()).enrolled ? { name: "on" } : { name: "off" }) : setStep({ name: "unknown" })))
      .catch(() => setStep({ name: "unknown" }));
  }, []);

  const post = (url: string, body?: unknown) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await post("/api/mfa/enroll");
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.qr) return setError("تعذّر بدء التفعيل. حاول مجددًا.");
      setStep({ name: "scan", factorId: data.factorId, qr: data.qr, secret: data.secret });
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.name !== "scan") return;
    setBusy(true);
    setError(null);
    try {
      const res = await post("/api/mfa/verify", { code, factorId: step.factorId });
      if (!res.ok) return setError("الرمز غير صحيح أو انتهت صلاحيته. أدخل الرمز الحالي من التطبيق.");
      setCode("");
      setStep({ name: "on" });
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8">
      <Section title="التحقق بخطوتين">
        {step.name === "loading" && <p className="text-sm text-muted">جارٍ التحميل...</p>}
        {step.name === "unknown" && <p className="text-sm text-muted">تعذّر معرفة حالة التحقق بخطوتين. أعد تحميل الصفحة.</p>}
        {step.name === "on" && (
          <p role="status" className="rounded border border-success-line bg-success-bg p-3 text-sm text-success">
            مفعّل: يُطلب رمز من تطبيق المصادقة عند الدخول بكلمة المرور.
          </p>
        )}
        {step.name === "off" && (
          <>
            <p className="text-sm text-foreground/75">
              أضف تطبيق مصادقة (مثل Google Authenticator أو Microsoft Authenticator) كي لا تكفي كلمة المرور وحدها لدخول لوحة الإدارة.
            </p>
            <button type="button" onClick={start} disabled={busy} className="w-full rounded-md bg-primary px-6 py-3 font-semibold text-primary-fg disabled:opacity-50">
              {busy ? "جارٍ التجهيز..." : "تفعيل التحقق بخطوتين"}
            </button>
          </>
        )}
        {step.name === "scan" && (
          <form onSubmit={confirm} className="flex flex-col gap-3">
            <p className="text-sm text-foreground/75">امسح الرمز بتطبيق المصادقة، ثم اكتب الرمز المكوّن من 6 أرقام الذي يعرضه.</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI from Supabase */}
            <img src={step.qr} alt="رمز QR لتطبيق المصادقة" width={176} height={176} className="self-center rounded border border-line bg-white p-2" />
            <p className="text-xs text-muted">
              أو أدخل المفتاح يدويًا: <span dir="ltr" className="select-all font-mono">{step.secret}</span>
            </p>
            <label htmlFor="mfa-code" className="text-sm font-medium">الرمز</label>
            <input
              id="mfa-code"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="w-full rounded-md border border-line px-3 py-2.5"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button type="submit" disabled={busy || code.length !== 6} className="w-full rounded-md bg-primary px-6 py-3 font-semibold text-primary-fg disabled:opacity-50">
              {busy ? "جارٍ التحقق..." : "تأكيد"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
            {error}
          </p>
        )}
      </Section>
    </div>
  );
}
