"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export interface UnfinishedRow {
  id: string;
  name: string;
  /** Formatted on the server (the phone library stays out of the bundle). */
  phone: string;
  license: string;
  licenseLabel: string;
  specialties: string[];
  /** Already formatted on the server. */
  started: string;
  reminded: string | null;
  /** Saved with the form, so the reminder can reopen it (newer signups). */
  canResume: boolean;
  /** What happened at the code step (lib/otp/summary.ts), "" if unknown. */
  codes: string;
}

export function UnfinishedList({ rows }: { rows: UnfinishedRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remind = async (id: string) => {
    setBusy(id);
    setError(null);
    // Opened before the request so the browser treats it as the click's
    // own window rather than a blocked popup.
    const tab = window.open("", "_blank");
    const res = await fetch(`/api/admin/pending-signups/${id}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok || !body.whatsapp) {
      tab?.close();
      setError("تعذّر إنشاء التذكير. ربما حُذف التسجيل؛ حدّث الصفحة.");
      return;
    }
    if (tab) tab.location.replace(body.whatsapp);
    else window.location.assign(body.whatsapp);
    startTransition(() => router.refresh());
  };

  const discard = async (id: string, name: string) => {
    if (!window.confirm(`حذف تسجيل د. ${name}؟ لن يمكن تذكيره بعدها.`)) return;
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/admin/pending-signups/${id}`, { method: "DELETE" });
    setBusy(null);
    // A 404 means it was already gone: refresh either way.
    if (res.ok || res.status === 404) startTransition(() => router.refresh());
    else setError("تعذّر الحذف. حاول مجددًا.");
  };

  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-muted">لا توجد تسجيلات معلّقة.</p>;
  }

  return (
    <>
      {error && (
        <p role="alert" className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold">د. {r.name}</p>
              <p className="text-sm text-muted">
                <span dir="ltr">{r.phone}</span>
                {r.license && (
                  <>
                    {" · "}
                    <span dir="ltr">{r.license}</span> ({r.licenseLabel})
                  </>
                )}
                {r.specialties.length > 0 && <> · {r.specialties.join("، ")}</>}
              </p>
              <p className="text-xs text-muted">
                بدأ {r.started}
                {r.reminded && <> · ذُكّر {r.reminded}</>}
              </p>
              {r.codes && <p className="text-xs text-muted">رمز التحقق: {r.codes}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              {r.canResume && (
                <button
                  type="button"
                  onClick={() => remind(r.id)}
                  disabled={pending || busy === r.id}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-fg disabled:opacity-50"
                >
                  {r.reminded ? "تذكير مرة أخرى" : "تذكير عبر واتساب"}
                </button>
              )}
              <button
                type="button"
                onClick={() => discard(r.id, r.name)}
                disabled={pending || busy === r.id}
                className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-foreground/40 disabled:opacity-50"
              >
                حذف
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
