"use client";

// Asked before accepting any doctor. For an exact registry match the question
// is how the admin knows this is that doctor, because name and number are
// public data (#16); for a licence the registry does not confirm, or a number
// an admin set by hand (typed or found by name), it is what the call rested
// on. Shared by the list row and the panel so neither can send an approval the
// API will refuse for a missing reason.
//
// The point is not to slow the admin down. It is that accepting a doctor is a
// decision someone made for a reason, and six months later the activity log
// should still say what it was.

import { useState } from "react";
import { licenseStatusLabel, PS_LABEL } from "@/lib/licenseStatus";

export const REASON_MIN = 3;

/** Why the API wants a reason: the row shows the status, only the server knows
 *  the number was corrected by hand. */
export type ReasonKind = "unconfirmed" | "corrected_number" | "identity";
/** What an approval attempt gives back: done, failed, or "ask for a reason". */
export type PatchResult = boolean | { ask: ReasonKind };
export const REASON_TOO_SHORT = "اكتب سببًا من 3 أحرف على الأقل.";

export function ApprovalReasonPrompt({
  name,
  status,
  region,
  busy,
  kind = "unconfirmed",
  onCancel,
  onConfirm,
}: {
  name: string;
  status: string | null;
  region: string | null;
  busy: boolean;
  kind?: ReasonKind;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const label = region === "PS" ? PS_LABEL : licenseStatusLabel(status);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) {
      setError(REASON_TOO_SHORT);
      return;
    }
    setError(null);
    await onConfirm(trimmed);
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-lg border border-warn-line bg-warn-bg p-3 text-sm"
    >
      <div>
        <p className="font-semibold">سبب القبول</p>
        <p className="text-foreground/80">
          {kind === "identity"
            ? `ترخيص د. ${name} يطابق سجل الوزارة، لكن الاسم والرقم معلومات علنية يستطيع أي شخص كتابتها، فالتطابق لا يثبت أنه صاحبها. اكتب كيف تأكّدت (اتصال بمكان عمله، زميل يعرفه، صورة الترخيص أو الهوية)؛ يُحفظ في سجل النشاط.`
            : kind === "corrected_number"
            ? `رقم ترخيص د. ${name} حدّدته الإدارة بيدها (كتابةً أو بالبحث بالاسم)، وتطابقه مع السجل لا يثبت الهوية. اكتب كيف تأكّدت منه (صورة الترخيص أو الهوية أو مكان العمل)؛ يُحفظ في سجل النشاط.`
            : `ترخيص د. ${name} ليس مطابقًا لسجل الوزارة (الحالة: ${label}). اكتب سببًا قصيرًا للقبول؛ يُحفظ في سجل النشاط.`}
        </p>
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={300}
        autoFocus
        aria-label="سبب القبول"
        placeholder="مثال: اتصلت بقسم الأطفال في المستشفى وأكّدوا أنه يعمل عندهم."
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
      />
      {error && <p className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-success-line bg-success-bg px-3 py-1.5 text-success hover:opacity-90 disabled:opacity-50"
        >
          قبول العضوية
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-line bg-surface px-3 py-1.5 hover:bg-foreground/5 disabled:opacity-50"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}
