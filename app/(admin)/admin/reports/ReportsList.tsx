"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export interface ReportRow {
  id: string;
  /** Already formatted on the server. */
  at: string;
  fromCard: boolean;
  /** The reported profile, when the report names one (a card, or a licence
   *  that matched). */
  target: { id: string; name: string } | null;
  license: string | null;
  reporter: { name: string; contact: string };
  details: string;
}

export function ReportsList({ rows }: { rows: ReportRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [closing, setClosing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/admin/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    // A 404 means another admin closed it first: refresh either way.
    if (res.ok || res.status === 404) {
      setClosing(null);
      setNote("");
      startTransition(() => router.refresh());
    } else {
      setError("اكتب ملاحظة قصيرة عمّا فعلت (حرفان على الأقل).");
    }
  };

  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-muted">لا توجد بلاغات مفتوحة.</p>;
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">
              {r.target ? (
                <Link href={`/admin?doctor=${r.target.id}`} className="underline">
                  د. {r.target.name}
                </Link>
              ) : (
                "لا ملف مطابق"
              )}
              {r.license && (
                <span className="ms-2 text-sm font-normal text-muted">
                  ترخيص <span dir="ltr">{r.license}</span>
                </span>
              )}
            </p>
            <p className="text-xs text-muted">
              {r.fromCard ? "من بطاقة طبيب" : "من نموذج الإبلاغ"} · {r.at}
            </p>
          </div>
          <p className="whitespace-pre-line text-sm">{r.details}</p>
          <p className="text-sm text-muted">
            المُبلِّغ: {r.reporter.name} · <span dir="ltr">{r.reporter.contact}</span>
          </p>
          {closing === r.id ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                aria-label="ملاحظة الإغلاق"
                placeholder="ماذا وجدت أو فعلت؟"
                className="min-w-0 flex-1 rounded-md border border-line bg-background px-3 py-2 text-base"
              />
              <button
                type="button"
                onClick={() => close(r.id)}
                disabled={pending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-fg disabled:opacity-50"
              >
                إغلاق البلاغ
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setClosing(r.id);
                setNote("");
                setError(null);
              }}
              className="self-start rounded-md border border-line px-3 py-1.5 text-sm hover:border-foreground/40"
            >
              إغلاق…
            </button>
          )}
          {closing === r.id && error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
