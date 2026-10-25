"use client";

// Changing the password of an admin's email sign-in (/login/dev). Saving it
// also signs out every other session (/api/profile/password), so a password
// that may have leaked stops working, and so do its sessions: at once for
// renewing them, and within the hour a session's token lasts (lib/auth/session.ts
// checks its signature, not the server).

import { useState } from "react";
import { Section } from "./ProfileFields";

const MIN = 16;

const ERRORS: Record<string, string> = {
  wrong_password: "كلمة المرور الحالية غير صحيحة.",
  weak_password: "كلمة المرور الجديدة مرفوضة: اختر كلمة أطول وغير مستخدمة في مكان آخر.",
  rate_limited: "محاولات كثيرة. حاول بعد ربع ساعة.",
};

function Field({ id, label, value, onChange, autoComplete, hint }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="password"
        required
        dir="ltr"
        autoComplete={autoComplete}
        minLength={autoComplete === "new-password" ? MIN : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="w-full rounded-md border border-line px-3 py-2.5"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function PasswordSection({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const mismatch = again.length > 0 && again !== next;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      if (res.ok) {
        setCurrent("");
        setNext("");
        setAgain("");
        setResult({ ok: true, text: "تم تغيير كلمة المرور. سيُسجَّل الخروج من كل الأجهزة الأخرى خلال ساعة على الأكثر." });
      } else {
        const data = await res.json().catch(() => ({}));
        setResult({ ok: false, text: ERRORS[data?.code] ?? "تعذّر تغيير كلمة المرور." });
      }
    } catch {
      setResult({ ok: false, text: "تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8">
      <Section title="كلمة المرور">
        <p className="text-sm text-foreground/75">
          لدخول فريق التطوير بالبريد <span dir="ltr">{email}</span>. بعد التغيير يُسجَّل الخروج من كل الأجهزة الأخرى خلال ساعة على الأكثر.
        </p>
        {/* Lets a password manager tie the new password to this account. */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <Field id="pw-current" label="كلمة المرور الحالية" value={current} onChange={setCurrent} autoComplete="current-password" />
        <Field
          id="pw-next"
          label="كلمة المرور الجديدة"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint={`${MIN} حرفًا على الأقل. الأسهل: اقتراح مدير كلمات المرور.`}
        />
        <Field id="pw-again" label="أعد كتابة كلمة المرور الجديدة" value={again} onChange={setAgain} autoComplete="new-password" />
        {mismatch && (
          <p role="alert" className="text-sm text-danger">
            الكلمتان غير متطابقتين.
          </p>
        )}
        {result && (
          <p
            role={result.ok ? "status" : "alert"}
            className={`rounded border p-3 text-sm ${result.ok ? "border-success-line bg-success-bg text-success" : "border-danger-line bg-danger-bg text-danger"}`}
          >
            {result.text}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !current || next.length < MIN || next !== again}
          className="w-full rounded-md bg-primary px-6 py-3 font-semibold text-primary-fg disabled:opacity-50"
        >
          {busy ? "جارٍ التغيير..." : "تغيير كلمة المرور"}
        </button>
      </Section>
    </form>
  );
}
