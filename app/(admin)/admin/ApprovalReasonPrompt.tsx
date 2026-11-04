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
import { APPROVAL_METHODS, APPROVAL_REASON_MIN, type ApprovalMethod } from "@/lib/admin/approvalMethods";

export const REASON_MIN = APPROVAL_REASON_MIN;

/** Why the API wants a reason: the row shows the status, only the server knows
 *  the number was corrected by hand. */
export type ReasonKind = "unconfirmed" | "corrected_number" | "identity";
/** What an approval attempt gives back: done, failed, or "ask for a reason". */
export type PatchResult = boolean | { ask: ReasonKind };
export const REASON_TOO_SHORT = `اكتب سببًا من ${APPROVAL_REASON_MIN} أحرف على الأقل.`;
export const METHOD_MISSING = "اختر كيف تأكّدت من هويته.";

export function ApprovalReasonPrompt({
  name,
  status,
  region,
  busy,
  kind = "unconfirmed",
  heading = "كيف تأكّدت من هويته؟",
  submitLabel = "قبول العضوية",
  lead: leadOverride,
  onCancel,
  onConfirm,
}: {
  name: string;
  status: string | null;
  region: string | null;
  busy: boolean;
  kind?: ReasonKind;
  /** The same question asked of an accepted doctor (the identity review). */
  heading?: string;
  submitLabel?: string;
  lead?: string;
  onCancel: () => void;
  onConfirm: (reason: string, method: ApprovalMethod) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<ApprovalMethod | null>(null);
  const [error, setError] = useState<string | null>(null);

  const label = region === "PS" ? PS_LABEL : licenseStatusLabel(status);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!method) {
      setError(METHOD_MISSING);
      return;
    }
    if (trimmed.length < REASON_MIN) {
      setError(REASON_TOO_SHORT);
      return;
    }
    setError(null);
    await onConfirm(trimmed, method);
  };

  const lead =
    leadOverride ??
    (kind === "identity"
      ? `ترخيص د. ${name} يطابق سجل الوزارة، لكن الاسم والرقم معلومات علنية يستطيع أي شخص كتابتها، فالتطابق لا يثبت أنه صاحبها.`
      : kind === "corrected_number"
        ? `رقم ترخيص د. ${name} حدّدته الإدارة بيدها (كتابةً أو بالبحث بالاسم)، وتطابقه مع السجل لا يثبت الهوية.`
        : `ترخيص د. ${name} ليس مطابقًا لسجل الوزارة (الحالة: ${label})، فلا شيء في السجل يثبت أنه هو.`);

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-warn-line bg-warn-bg p-3 text-sm"
    >
      <div>
        <p className="font-semibold">{heading}</p>
        <p className="text-foreground/80">
          {lead} لا تعتمد على رقم هاتف أو مكان عمل مكتوب في ملفه، ولا على الرقم الذي سجّل به: كلها من إدخاله هو.
          يُحفظ ما تكتبه في سجل النشاط.
        </p>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">طريقة التأكد</legend>
        {APPROVAL_METHODS.map((m) => (
          <label key={m.key} className="flex items-start gap-2">
            <input
              type="radio"
              name="approval_method"
              value={m.key}
              checked={method === m.key}
              onChange={() => setMethod(m.key)}
              className="mt-1"
            />
            <span>{m.label}</span>
          </label>
        ))}
      </fieldset>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={300}
        aria-label="سبب القبول"
        placeholder="مثال: اتصلت بمقسم المستشفى وأكّدوا أنه يعمل في قسم الأطفال."
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
      />
      {error && <p className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-success-line bg-success-bg px-3 py-1.5 text-success hover:opacity-90 disabled:opacity-50"
        >
          {submitLabel}
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
