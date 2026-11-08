"use client";

// Stuck to the bottom of the panel while a doctor waits, so the decision is one
// tap away however far down the licence check and the rest of the record the
// admin has scrolled. Also where the question «كيف تأكّدت من هويته؟», a save that
// failed and, once answered, the message to send the doctor appear: the admin is
// looking at the bar then, not at the top of a long panel.

import { ApprovedNotice } from "./ApprovedNotice";
import { ApprovalReasonPrompt } from "./ApprovalReasonPrompt";
import type { Approval } from "./useApproval";
import type { SwitchDoctor } from "./StateSwitches";
import { directoryVisibility } from "@/lib/admin/doctorState";
import { toneChip } from "@/lib/licenseStatus";

export function AcceptBar({
  doctor,
  busy,
  approval,
  notice,
}: {
  doctor: SwitchDoctor;
  busy: boolean;
  approval: Approval;
  /** A save that went wrong (or right), said here while the doctor waits. */
  notice: { ok: boolean; text: string } | null;
}) {
  const name = `${doctor.arabic_first_name} ${doctor.arabic_family_name}`;
  const waiting = doctor.is_active && !doctor.is_admin_approved;

  let body: React.ReactNode = null;
  if (approval.told && doctor.is_admin_approved) {
    body = (
      <ApprovedNotice doctorId={doctor.id} phone={doctor.phone_e164} firstName={doctor.arabic_first_name} listed={directoryVisibility(doctor).listed} />
    );
  } else if (approval.asking) {
    body = (
      <ApprovalReasonPrompt
        name={name}
        status={doctor.license_verification_status}
        region={doctor.license_region}
        busy={busy}
        kind={approval.kind}
        onCancel={approval.cancel}
        onConfirm={approval.confirm}
      />
    );
  } else if (waiting) {
    // Also while the page behind catches up with an acceptance (told, not yet
    // accepted there), and after one is taken back: never a bar with nothing to tap.
    body = (
      <div className="flex items-center justify-between gap-3">
        <span className={toneChip("warn")}>بانتظار القبول</span>
        <button
          type="button"
          disabled={busy}
          onClick={approval.start}
          className="rounded-md border border-success-line bg-success-bg px-4 py-2 text-sm font-medium text-success hover:opacity-90 disabled:opacity-50 pointer-coarse:py-3"
        >
          قبول العضوية
        </button>
      </div>
    );
  }

  if (!body && !notice) return null;
  return (
    <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex max-h-[70dvh] flex-col gap-2 overflow-y-auto overscroll-contain border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.25)]">
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          className={
            "rounded-md border px-3 py-2 text-sm " +
            (notice.ok ? "border-success-line bg-success-bg text-success" : "border-danger-line bg-danger-bg text-danger")
          }
        >
          {notice.text}
        </p>
      )}
      {/* A region that is always there, so what lands in it is announced. */}
      <div aria-live="polite">{body}</div>
    </div>
  );
}
