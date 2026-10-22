"use client";

import { useRef, useState } from "react";
import { Field } from "@/components/FormField";
import { InputStyles } from "@/components/InputStyles";
import { type TurnstileHandle, TurnstileWidget } from "@/components/TurnstileWidget";
import { toAsciiDigits } from "@/lib/normalize/digits";

export function ReportForm({ license: initialLicense }: { license: string }) {
  const [license, setLicense] = useState(initialLicense);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [details, setDetails] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      const fresh = token || ((await turnstile.current?.getToken(15_000)) ?? "");
      const res = await fetch("/api/reports/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_number: license.trim() || null, name, contact, details, turnstile_token: fresh }),
      });
      setToken("");
      turnstile.current?.reset();
      if (!res.ok) {
        const code = (await res.json().catch(() => ({})))?.code;
        setError(
          code === "rate_limited"
            ? "أرسلت بلاغات كثيرة. حاول بعد ساعة."
            : code === "invalid_body"
              ? "أكمل الحقول: الاسم، وسيلة التواصل، وما حدث (5 أحرف على الأقل)."
              : "تعذّر الإرسال. حاول مجددًا.",
        );
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا.");
      setState("idle");
    }
  };

  if (state === "sent") {
    return (
      <p role="status" className="rounded-md border border-success-line bg-success-bg p-4 text-success">
        وصلنا بلاغك. ستراجعه الإدارة وتتواصل معك.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-surface p-5">
      <InputStyles />
      <Field label="اسمك" htmlFor="name" required>
        <input id="name" required minLength={2} maxLength={100} className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="رقم هاتفك أو بريدك، لنتواصل معك" htmlFor="contact" required>
        <input
          id="contact"
          required
          minLength={5}
          maxLength={100}
          dir="ltr"
          className="input"
          value={contact}
          onChange={(e) => setContact(toAsciiDigits(e.target.value))}
        />
      </Field>
      <Field label="رقم الترخيص المعني (إن وُجد)" htmlFor="license">
        <input
          id="license"
          maxLength={20}
          dir="ltr"
          inputMode="numeric"
          className="input"
          value={license}
          onChange={(e) => setLicense(toAsciiDigits(e.target.value))}
        />
      </Field>
      <Field label="ماذا حدث؟" htmlFor="details" required>
        <textarea
          id="details"
          required
          minLength={5}
          maxLength={1000}
          rows={4}
          className="input"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </Field>
      {error && (
        <p role="alert" className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === "sending"}
        className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-fg disabled:opacity-50"
      >
        {state === "sending" ? "جارٍ الإرسال…" : "إرسال البلاغ"}
      </button>
      <TurnstileWidget ref={turnstile} onToken={setToken} action="report" />
    </form>
  );
}
