"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Mode = "signup" | "login";

const SS_PHONE = "verify:phone";
const SS_SESSION = "verify:signup_session";

export function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "login" ? "login" : "signup";

  // Phone + signup session id are passed via sessionStorage instead of URL
  // to keep PII out of browser history, server logs, and Referer headers.
  const [phone, setPhone] = useState("");
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    const p = sessionStorage.getItem(SS_PHONE) ?? "";
    const s = sessionStorage.getItem(SS_SESSION) ?? "";
    setPhone(p);
    setSessionId(s);

    // Direct hit on /verify with no prior /login or /signup → bounce home.
    if (mode === "login" && !p) {
      router.replace("/login");
    } else if (mode === "signup" && (!p || !s)) {
      router.replace("/signup");
    }
  }, [mode, router]);

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(60);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const url =
        mode === "signup" ? "/api/signup/verify" : "/api/login/verify";
      const body =
        mode === "signup"
          ? { signup_session_id: sessionId, otp_code: code }
          : { phone, otp_code: code };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.code === "invalid_otp") {
          setError("رمز التحقق غير صحيح. حاول مرة أخرى.");
        } else if (data?.code === "session_expired") {
          setError("انتهت صلاحية الجلسة. الرجاء البدء من جديد.");
        } else if (data?.code === "too_many_attempts") {
          setError("عدد المحاولات تجاوز الحد. الرجاء البدء من جديد.");
        } else if (data?.code === "rate_limited") {
          setError("عدد كبير من المحاولات. حاول لاحقًا.");
        } else {
          setError("حدث خطأ. الرجاء المحاولة لاحقًا.");
        }
        setSubmitting(false);
        return;
      }
      // Drop sensitive state and hard-navigate so the server renders the
      // layout from scratch with the new session cookie. router.refresh()
      // only invalidates the current route's RSC cache and races with the
      // router.replace() — full-page load is the only reliable way to
      // guarantee the SiteHeader picks up the authenticated session.
      sessionStorage.removeItem(SS_PHONE);
      sessionStorage.removeItem(SS_SESSION);
      window.location.replace("/dashboard");
    } catch (err) {
      console.error(err);
      setError("حدث خطأ في الاتصال بالخادم.");
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0) return;
    setError(null);
    if (mode === "login") {
      await fetch("/api/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
    } else {
      // For signup we'd need the full form; tell the user to restart.
      setError("الرجاء إعادة التسجيل لطلب رمز جديد.");
      return;
    }
    setResendIn(60);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        type="text"
        dir="ltr"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={8}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded-md border border-foreground/20 px-4 py-3 text-center text-2xl tracking-[0.5em]"
        placeholder="------"
        required
      />

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || code.length < 4}
        className="w-full rounded-md bg-foreground px-6 py-3 text-background disabled:opacity-50"
      >
        {submitting ? "جارٍ التحقق..." : "تأكيد"}
      </button>

      <button
        type="button"
        onClick={resend}
        disabled={resendIn > 0 || mode === "signup"}
        className="w-full rounded-md border border-foreground px-6 py-2 text-sm disabled:opacity-50"
      >
        {resendIn > 0
          ? `إعادة إرسال الرمز خلال ${resendIn} ثانية`
          : "إعادة إرسال الرمز"}
      </button>
    </form>
  );
}
