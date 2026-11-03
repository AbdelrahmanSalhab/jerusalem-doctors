"use client";

// «تمت المراجعة»: the admin has looked at a licence the registry does not
// confirm and accepts it as it is, so it leaves «ترخيص يحتاج مراجعة»
// (/api/admin/doctors/[id]/license/reviewed). Shows when and that it was done
// once it has been.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { explainDate } from "@/lib/moh/explain";

export function LicenseReviewed({ doctorId, reviewedAt }: { doctorId: string; reviewedAt: string | null }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reviewedAt) {
    return <p className="text-xs text-muted">روجع هذا الترخيص في {explainDate(reviewedAt)}، فلا يظهر في «ترخيص يحتاج مراجعة».</p>;
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/doctors/${doctorId}/license/reviewed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError("تعذّر الحفظ. حاول مرة أخرى.");
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3 text-sm">
      <p className="text-foreground/80">راجعت هذا الترخيص وأقبله كما هو؟ يخرج من «ترخيص يحتاج مراجعة»، ويعود إليها إن رصده السجل مفقودًا لاحقًا.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`license-reviewed-note-${doctorId}`}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          aria-label="ملاحظة (اختياري)"
          placeholder="ملاحظة (اختياري): ما الذي تحققت منه"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-base"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="shrink-0 rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50"
        >
          تمت المراجعة
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
