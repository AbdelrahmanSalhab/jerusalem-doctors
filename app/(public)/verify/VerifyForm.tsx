"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Mode = "signup" | "login";

import {
  SS_PHONE,
  SS_SESSION,
  clearHandoff,
  getHandoff,
} from "@/lib/client/verify_handoff";
import { apiErrorMessage } from "@/lib/client/apiError";
import { SupportContact } from "@/components/SupportContact";
import { toAsciiDigits } from "@/lib/normalize/digits";
import { OTP_LENGTH, RESEND_AFTER_SECONDS, validityText } from "@/lib/otp/expiry";
import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/components/TurnstileWidget";

const TURNSTILE_WAIT_MS = 15_000;
const noop = () => {};

export function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "login" ? "login" : "signup";

  // Phone + signup session id are passed via sessionStorage instead of URL
  // to keep PII out of browser history, server logs, and Referer headers.
  const [phone, setPhone] = useState("");
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    const p = getHandoff(SS_PHONE);
    const s = getHandoff(SS_SESSION);
    // Browser-only storage: reading it during render would differ from the
    // server render and break hydration, so it is read once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  // A new code is offered a minute after the last send (lib/otp/expiry.ts).
  const [resendIn, setResendIn] = useState(RESEND_AFTER_SECONDS);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Said after a resend: the earlier code stopped working, and it is the one
  // a doctor is most likely to type when both texts arrive.
  const [notice, setNotice] = useState<string | null>(null);
  // Login resends are Turnstile-gated (they spend the shared SMS budget);
  // signup resends are bound to the signup session instead.
  const turnstileRef = useRef<TurnstileHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Bumped on every send: each text gets its own wait for the phone to read it.
  const [sends, setSends] = useState(1);

  // Android Chrome can read the text itself when it ends "@host #code"
  // (lib/otp/message.ts). Anywhere else this does nothing and the doctor
  // types, or iOS offers the code on the keyboard.
  useEffect(() => {
    if (!("OTPCredential" in window)) return;
    const abort = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ["sms"] }, signal: abort.signal } as CredentialRequestOptions)
      .then((c) => {
        const read = toAsciiDigits((c as { code?: string } | null)?.code ?? "").replace(/\D/g, "");
        if (read) setCode(read.slice(0, OTP_LENGTH));
      })
      .catch(() => {});
    return () => abort.abort();
  }, [sends]);

  // The last digit sends it: nothing left to tap in a minute that counts.
  // Once per code: a refused one is cleared below, so it can't loop.
  useEffect(() => {
    if (code.length === OTP_LENGTH && !submitting) formRef.current?.requestSubmit();
    // submitting is left out on purpose: it flips back to false after a refusal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // A refused code is cleared and the cursor put back, so the next one is typed
  // (or autofilled) into an empty field.
  const clearCode = () => {
    setCode("");
    inputRef.current?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
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
          // Supabase answers the same for a wrong code and an expired one.
          setError("الرمز غير صحيح أو انتهت صلاحيته. استخدم آخر رمز وصلك، أو اطلب رمزًا جديدًا.");
          clearCode();
        } else if (data?.code === "session_expired") {
          setError("انتهت صلاحية الجلسة. الرجاء البدء من جديد.");
        } else if (data?.code === "account_inactive") {
          setError("الحساب غير مفعّل. تواصل مع الإدارة.");
        } else if (data?.code === "too_many_attempts") {
          // This code has had its guesses; the signup stays, a new code goes on.
          setError("محاولات كثيرة بهذا الرمز. اطلب رمزًا جديدًا.");
          clearCode();
          setResendIn(0);
        } else if (data?.code === "rate_limited") {
          setError("محاولات كثيرة. انتظر عشر دقائق، ثم اطلب رمزًا جديدًا.");
        } else {
          setError("حدث خطأ. الرجاء المحاولة لاحقًا.");
        }
        setSubmitting(false);
        return;
      }
      // Drop sensitive state and hard-navigate so the server renders the
      // layout from scratch with the new session cookie. router.refresh()
      // only invalidates the current route's RSC cache and races with the
      // router.replace(), full-page load is the only reliable way to
      // guarantee the SiteHeader picks up the authenticated session.
      clearHandoff(SS_PHONE);
      clearHandoff(SS_SESSION);
      // A signup whose phone already had an account signed its owner in
      // instead; the dashboard says so.
      window.location.replace(data?.existing_account ? "/dashboard?existing=1" : "/dashboard");
    } catch (err) {
      console.error(err);
      setError("حدث خطأ في الاتصال بالخادم.");
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0 || resending) return;
    setError(null);
    setNotice(null);
    setResending(true);

    // Dedicated resend endpoints rather than re-posting to /*/start: those are
    // Turnstile-gated and the token is single-use, so a replay 403s in prod.
    const url = mode === "signup" ? "/api/signup/resend" : "/api/login/resend";

    try {
      const body =
        mode === "signup"
          ? { signup_session_id: sessionId }
          : {
              phone,
              turnstile_token:
                (await turnstileRef.current?.getToken(TURNSTILE_WAIT_MS)) ?? "",
            };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // Tokens are single-use: the next resend needs a fresh one either way.
      turnstileRef.current?.reset();
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.code === "turnstile_failed") {
          setError("لم يكتمل التحقق من المتصفح. تأكد من الاتصال وأعد المحاولة.");
        } else if (data?.code === "session_expired") {
          setError("انتهت صلاحية الجلسة. الرجاء البدء من جديد.");
        } else {
          setError(apiErrorMessage(data?.code, "تعذّر إرسال الرمز. حاول لاحقًا."));
        }
        return;
      }
      setResendIn(RESEND_AFTER_SECONDS);
      setSends((n) => n + 1);
      setCode("");
      setNotice("أرسلنا رمزًا جديدًا. استخدم آخر رمز وصلك فقط؛ الرمز السابق لم يعد يعمل.");
    } catch (err) {
      console.error(err);
      setError("حدث خطأ في الاتصال بالخادم.");
    } finally {
      setResending(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4">
      <input
        ref={inputRef}
        type="text"
        dir="ltr"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="رمز التحقق"
        maxLength={OTP_LENGTH}
        pattern={`\\d{${OTP_LENGTH}}`}
        value={code}
        onChange={(e) => setCode(toAsciiDigits(e.target.value).replace(/\D/g, ""))}
        className="w-full rounded-md border border-foreground/20 px-4 py-3 text-center text-2xl tracking-[0.5em]"
        placeholder="------"
        required
        aria-describedby="otp-validity"
      />
      <p id="otp-validity" className="text-center text-sm text-muted">
        {resendIn > 0
          ? `الرمز صالح لمدة ${validityText()} فقط من إرساله.`
          : "إن لم يصلك الرمز أو لم يعمل، اطلب رمزًا جديدًا."}
      </p>

      {notice && (
        <p role="status" className="rounded border border-info-line bg-info-bg p-3 text-sm text-info">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || code.length !== OTP_LENGTH}
        className="w-full rounded-md bg-primary px-6 py-3 text-primary-fg disabled:opacity-50"
      >
        {submitting ? "جارٍ التحقق..." : "تأكيد"}
      </button>

      <button
        type="button"
        onClick={resend}
        disabled={resendIn > 0 || resending}
        className="w-full rounded-md border border-foreground px-6 py-2 text-sm disabled:opacity-50"
      >
        {resending
          ? "جارٍ الإرسال..."
          : resendIn > 0
            ? `إعادة إرسال الرمز خلال ${resendIn} ثانية`
            : "إعادة إرسال الرمز"}
      </button>

      {mode === "login" && (
        <TurnstileWidget ref={turnstileRef} onToken={noop} action="login_resend" />
      )}

      <NoCodeHelp mode={mode} phone={phone} />
    </form>
  );
}

/**
 * Shown from the start, to everyone: login answers "code sent" for any number
 * (no account enumeration), so the page can't say whether a text is coming.
 * It says what usually goes wrong, true for any visitor, and how to reach us.
 */
function NoCodeHelp({ mode, phone }: { mode: Mode; phone: string }) {
  return (
    <div className="space-y-2 rounded-md border border-info-line bg-info-bg p-4 text-sm text-info">
      <p className="font-medium">لم يصلك الرمز؟</p>
      <ul className="list-disc space-y-1 ps-5">
        <li>
          قد يتأخر نحو نصف دقيقة. الرقم الذي أدخلته:{" "}
          <span dir="ltr" className="font-medium">
            {phone}
          </span>
          {" "}
          <Link href={mode === "login" ? "/login" : "/signup"} className="underline">
            (رقم خاطئ؟ صحّحه)
          </Link>
          .
        </li>
        <li>استخدم الرقم نفسه الذي سجّلت به في الدليل.</li>
        {mode === "login" && (
          <li>
            إن لم تسجّل بعد،{" "}
            <Link href="/signup" className="underline">
              أنشئ حسابًا
            </Link>{" "}
            أولًا.
          </li>
        )}
        <li>إن بقي الأمر كذلك، اطلب رمزًا جديدًا بعد انتهاء العدّ التنازلي.</li>
      </ul>
      <SupportContact />
    </div>
  );
}
