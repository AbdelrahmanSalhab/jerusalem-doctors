"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buildWhatsAppLink } from "@/lib/whatsapp";

interface Row {
  id: string;
  query: string;
  /** Already formatted on the server. */
  asked_at: string;
  requester: { arabic_full_name: string; phone_e164: string } | null;
}

export function RequestsList({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const resolve = async (id: string) => {
    setBusy(id);
    const res = await fetch(`/api/admin/number-requests/${id}`, { method: "PATCH" });
    setBusy(null);
    // A 404 means another admin closed it first: refresh either way.
    if (res.ok || res.status === 404) startTransition(() => router.refresh());
  };

  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-muted">لا توجد طلبات.</p>;
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold">«{r.query}»</p>
            <p className="text-sm text-muted">
              {r.requester?.arabic_full_name ?? "حساب محذوف"} · {r.asked_at}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {r.requester && (
              <a
                href={buildWhatsAppLink(r.requester.phone_e164, "")}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-foreground/40"
              >
                واتساب
              </a>
            )}
            <button
              type="button"
              onClick={() => resolve(r.id)}
              disabled={pending || busy === r.id}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-fg disabled:opacity-50"
            >
              تم
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
