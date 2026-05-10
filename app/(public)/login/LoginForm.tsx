"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/components/TurnstileWidget";

// Allow only digits, +, -, space, parens — common phone-number characters.
// Server-side `normalizePhone` is the source of truth; this just keeps
// junk out of the input as the user types or pastes.
const PHONE_DISALLOWED = /[^0-9+\-\s()]/g;

export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  const handleTurnstileToken = useCallback(
    (t: string) => setTurnstileToken(t),
    [],
  );

  const onPhoneChange = (next: string) => {
    // Strip disallowed chars instead of rejecting the whole input — this
    // makes paste-from-WhatsApp ("Phone: 050-...") work seamlessly.
    setPhone(next.replace(PHONE_DISALLOWED, ""));
    // Clear stale errors as the user edits — previous error no longer
    // applies to the new input.
    if (error) setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!phone.trim()) {
      setError("الرجاء إدخال رقم الهاتف.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, turnstile_token: turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Turnstile tokens are single-use — reset the widget after every
        // submit so a retry gets a fresh token.
        turnstileRef.current?.reset();
        if (data?.code === "not_found") {
          setError("رقم الهاتف غير موجود في النظام. الرجاء إنشاء حساب جديد.");
        } else if (data?.code === "invalid_phone") {
          setError("صيغة رقم الهاتف غير صحيحة.");
        } else if (data?.code === "account_inactive") {
          setError("الحساب غير مفعّل. تواصل مع الإدارة.");
        } else if (data?.code === "rate_limited") {
          setError("عدد كبير من المحاولات. حاول لاحقًا.");
        } else if (data?.code === "turnstile_failed") {
          setError("لم يكتمل التحقق من المتصفح. الرجاء المحاولة مرة أخرى.");
        } else {
          setError("حدث خطأ. الرجاء المحاولة لاحقًا.");
        }
        setSubmitting(false);
        return;
      }

      // Stash phone in sessionStorage instead of the URL — keeps PII out of
      // browser history, server logs, and Referer headers.
      sessionStorage.setItem("verify:phone", phone);
      sessionStorage.removeItem("verify:signup_session");
      router.push("/verify?mode=login");
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
          inputMode="tel"
          pattern="[0-9+\-\s()]*"
          className="w-full rounded-md border border-foreground/20 px-3 py-2.5"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          placeholder="0501234567"
        />
      </div>

      <TurnstileWidget
        ref={turnstileRef}
        onToken={handleTurnstileToken}
        action="login"
      />

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
