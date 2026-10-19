// One licence slot: the number, what the check concluded, and why.
//
// The "why" is the part that did not exist. An admin saw a chip reading
// "تطابق جزئي" or "غير موجود في السجل" and had no way to find out what it
// meant for this particular doctor, which made the queue a guessing game.

import { LicenseCheckPanel } from "./LicenseCheckPanel";
import type { LicenseSlotDetail } from "@/lib/admin/doctorDetail";
import { licenseDisplay, toneChip } from "@/lib/licenseStatus";

const REGION_LABEL: Record<string, string> = { IL: "إسرائيل", PS: "فلسطين" };

const TONE_BOX: Record<string, string> = {
  success: "border-success-line bg-success-bg",
  warn: "border-warn-line bg-warn-bg",
  danger: "border-danger-line bg-danger-bg",
  neutral: "border-line bg-background/60",
};

export function LicenseSection({ doctorId, slot }: { doctorId: string; slot: LicenseSlotDetail }) {
  const chip = licenseDisplay({ status: slot.status, region: slot.region });
  const e = slot.explanation;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{slot.label}</span>
        <span dir="ltr" className="tabular-nums text-sm">
          {slot.number}
        </span>
        <span className="text-xs text-muted">({REGION_LABEL[slot.region] ?? slot.region})</span>
        <span className={toneChip(chip.tone)}>{chip.label}</span>
      </div>

      {slot.slot === "secondary" && (
        <p className="text-xs text-muted">الترخيص الإضافي لا يؤثر على قبول العضوية.</p>
      )}

      <div className={`flex flex-col gap-1.5 rounded-lg border p-3 text-sm ${TONE_BOX[e.tone] ?? TONE_BOX.neutral}`}>
        <p className="font-medium">{e.headline}</p>
        <ul className="flex flex-col gap-1 ps-4">
          {e.reasons.map((r, i) => (
            <li key={i} className="list-disc text-foreground/80">
              {r}
            </li>
          ))}
        </ul>
        {e.nextStep && <p className="text-foreground/80">{e.nextStep}</p>}
        {e.derivedNow && (
          <p className="text-xs text-muted">محسوبة الآن من نسخة السجل الحالية، لا من نتيجة وقت التسجيل.</p>
        )}
      </div>

      <LicenseCheckPanel doctorId={doctorId} slot={slot.slot} region={slot.region} storedNumber={slot.number} />
    </div>
  );
}
