"use client";

// Services, procedures and certificates a doctor lists, one per row. Blank rows are
// dropped server-side (lib/certificates.ts), so no row needs validating here.

import { CERTIFICATE_MAX_LENGTH, CERTIFICATES_MAX } from "@/lib/certificates";

export function CertificatesEditor({
  id,
  value,
  onChange,
}: {
  id: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const rows = value.length ? value : [""];
  const set = (i: number, v: string) => onChange(rows.map((r, j) => (j === i ? v : r)));

  return (
    <div className="space-y-2">
      {rows.map((cert, i) => (
        <div key={i} className="flex gap-2">
          <input
            id={i === 0 ? id : `${id}_${i}`}
            aria-label={`خدمة أو شهادة ${i + 1}`}
            className="input flex-1"
            maxLength={CERTIFICATE_MAX_LENGTH}
            value={cert}
            onChange={(e) => set(i, e.target.value)}
            placeholder="مثلاً: دبلوم طب الأسرة، ACLS، ماجستير صحة عامة"
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="shrink-0 rounded border border-foreground/20 px-3 text-base hover:bg-foreground/5"
              aria-label={`حذف شهادة ${i + 1}`}
            >
              حذف
            </button>
          )}
        </div>
      ))}
      {rows.length < CERTIFICATES_MAX && (
        <button
          type="button"
          onClick={() => onChange([...rows, ""])}
          className="rounded border border-dashed border-foreground/30 px-4 py-2 text-base text-foreground/80 hover:bg-foreground/5"
        >
          + إضافة شهادة
        </button>
      )}
    </div>
  );
}
