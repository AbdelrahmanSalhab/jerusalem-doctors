"use client";

// Same shape as the doctors' login form (app/(public)/login/LoginForm.tsx),
// in Arabic like the rest of the site. Only the email and the password read
// left to right, being Latin text inside an RTL page.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/lib/client/apiError";

export function DevLoginForm({ sentForCode = false }: { sentForCode?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The code step (#164): shown when the session is a password one that
  // still has to pass the authenticator challenge, straight after the
  // password or when the admin panel sent them back here.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  const waitingForCode = async (): Promise<boolean> => {
    const res = await fetch("/api/mfa");
    return res.ok && (await res.json()).waiting === true;
  };

  useEffect(() => {
    if (!sentForCode) return;
    waitingForCode()
      .then((waiting) => {
        setNeedsCode(waiting);
        // Sent here for a code this account has no authenticator to give.
        if (!waiting) setError("هذا الحساب لم يفعّل التحقق بخطوتين بعد. تواصل مع المسؤولين لتفعيله.");
      })
      .catch(() => {});
  }, [sentForCode]);

  const startOver = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setNeedsCode(false);
    setCode("");
    setError(null);
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) return setError("الرمز غير صحيح أو انتهت صلاحيته.");
      router.push("/admin");
      router.refresh();
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا.");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/login/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // The server answers the same way for every refusal on purpose, so
        // this says no more than the server does.
        setError(apiErrorMessage(data?.code));
        return;
      }
      if ((await res.json().catch(() => null))?.needs_code === true) {
        setNeedsCode(true);
        return;
      }
      // A fresh server render picks up the session cookie the route just set.
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا.");
    } finally {
      setSubmitting(false);
    }
  };

  if (needsCode) {
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-4">
        <label htmlFor="dev-code" className="block text-sm font-medium">
          رمز تطبيق المصادقة
        </label>
        <input
          id="dev-code"
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="w-full rounded-md border border-line px-3 py-2.5"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
        {error && (
          <p role="alert" className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting || code.length !== 6} className="w-full rounded-md bg-primary px-6 py-3 text-primary-fg disabled:opacity-50">
          {submitting ? "جارٍ التحقق..." : "تأكيد"}
        </button>
        <button type="button" onClick={startOver} className="text-sm underline">
          العودة وتسجيل الدخول بحساب آخر
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="dev-email" className="mb-1.5 block text-sm font-medium">
          البريد الإلكتروني
        </label>
        <input
          id="dev-email"
          type="email"
          required
          dir="ltr"
          autoComplete="username"
          inputMode="email"
          className="w-full rounded-md border border-line px-3 py-2.5"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="dev-password" className="mb-1.5 block text-sm font-medium">
          كلمة المرور
        </label>
        <input
          id="dev-password"
          type="password"
          required
          dir="ltr"
          minLength={8}
          autoComplete="current-password"
          className="w-full rounded-md border border-line px-3 py-2.5"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !email.trim() || !password}
        className="w-full rounded-md bg-primary px-6 py-3 text-primary-fg disabled:opacity-50"
      >
        {submitting ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
      </button>
    </form>
  );
}
