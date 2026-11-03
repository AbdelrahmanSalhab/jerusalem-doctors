"use client";

// A super admin removes another admin's authenticator after a lost phone
// (/api/admin/doctors/[id]/mfa/reset). The admin then has a quarter of an hour to enrol a
// new one from «ملفي». Two presses: the first asks, the second does it.

import { useState } from "react";

export function MfaReset({ doctorId }: { doctorId: string }) {
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/doctors/${doctorId}/mfa/reset`, { method: "POST" });
      setResult(
        res.ok
          ? { ok: true, text: "أُزيل تطبيق المصادقة. أمامه ربع ساعة ليفعّل تطبيقًا جديدًا من «ملفي»؛ كن معه على الخط." }
          : { ok: false, text: "تعذّرت إعادة التعيين. حاول مرة أخرى." },
      );
    } catch {
      setResult({ ok: false, text: "تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا." });
    }
    setAsked(false);
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3 text-sm">
      <p className="text-foreground/80">فقد هذا المسؤول هاتفه؟ تُزيل إعادة التعيين تطبيق المصادقة المرتبط بحسابه، ويُسجَّل ذلك في سجل النشاط.</p>
      {asked ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={reset} disabled={busy} className="rounded-md bg-danger px-3 py-1.5 text-sm text-white disabled:opacity-50">
            نعم، أزِل التحقق بخطوتين
          </button>
          <button type="button" onClick={() => setAsked(false)} disabled={busy} className="rounded-md border border-line px-3 py-1.5 text-sm">
            إلغاء
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAsked(true)} className="self-start rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-foreground/5">
          إعادة تعيين التحقق بخطوتين
        </button>
      )}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
