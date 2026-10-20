"use client";

// Same shape as the doctors' login form (app/(public)/login/LoginForm.tsx),
// in Arabic like the rest of the site. Only the email and the password read
// left to right, being Latin text inside an RTL page.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiErrorMessage } from "@/lib/client/apiError";

export function DevLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // A fresh server render picks up the session cookie the route just set.
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا.");
    } finally {
      setSubmitting(false);
    }
  };

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
