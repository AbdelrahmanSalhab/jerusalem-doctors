"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";

export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const handleTurnstileToken = useCallback(
    (t: string) => setTurnstileToken(t),
    [],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, turnstile_token: turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.code === "not_found") {
          setError("رقم الهاتف غير موجود في النظام. الرجاء إنشاء حساب جديد.");
        } else if (data?.code === "invalid_phone") {
          setError("صيغة رقم الهاتف غير صحيحة.");
        } else if (data?.code === "account_inactive") {
          setError("الحساب غير مفعّل. تواصل مع الإدارة.");
        } else if (data?.code === "rate_limited") {
          setError("عدد كبير من المحاولات. حاول لاحقًا.");
        } else {
          setError("حدث خطأ. الرجاء المحاولة لاحقًا.");
        }
        setSubmitting(false);
        return;
      }

      const params = new URLSearchParams({ mode: "login", phone });
      router.push(`/verify?${params.toString()}`);
    } catch (err) {
      console.error(err);
      setError("حدث خطأ في الاتصال بالخادم.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium">رقم الهاتف</label>
        <input
          type="tel"
          required
          dir="ltr"
          autoComplete="tel"
          className="w-full rounded-md border border-foreground/20 px-3 py-2.5"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0501234567"
        />
      </div>

      <TurnstileWidget onToken={handleTurnstileToken} action="login" />

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !phone.trim()}
        className="w-full rounded-md bg-foreground px-6 py-3 text-background disabled:opacity-50"
      >
        {submitting ? "جارٍ الإرسال..." : "إرسال رمز التحقق"}
      </button>

      <p className="text-center text-sm text-foreground/70">
        ليس لديك حساب؟{" "}
        <a className="underline" href="/signup">
          إنشاء حساب جديد
        </a>
      </p>
    </form>
  );
}
