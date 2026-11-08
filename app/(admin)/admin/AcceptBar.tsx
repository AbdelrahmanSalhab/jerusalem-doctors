"use client";

// Stuck to the bottom of the panel while a doctor waits, so the decision is one
// tap away however far down the licence check and the rest of the record the
// admin has scrolled. Also where the question «كيف تأكّدت من هويته؟» and, once
// answered, the message to send the doctor appear.

import { ApprovedNotice } from "./ApprovedNotice";
import { ApprovalReasonPrompt } from "./ApprovalReasonPrompt";
import type { Approval } from "./useApproval";
import type { SwitchDoctor } from "./StateSwitches";
import { directoryVisibility } from "@/lib/admin/doctorState";
import { toneChip } from "@/lib/licenseStatus";

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 -mb-4 max-h-[75vh] overflow-y-auto border-t border-line bg-surface px-4 py-3 shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.25)]">
      {children}
    </div>
  );
}

export function AcceptBar({ doctor, busy, approval }: { doctor: SwitchDoctor; busy: boolean; approval: Approval }) {
  const name = `${doctor.arabic_first_name} ${doctor.arabic_family_name}`;

  if (approval.told) {
    // Until the page behind has the doctor as accepted there is nothing to show.
    if (!doctor.is_admin_approved) return null;
    return (
      <Bar>
        <ApprovedNotice doctorId={doctor.id} phone={doctor.phone_e164} firstName={doctor.arabic_first_name} listed={directoryVisibility(doctor).listed} />
      </Bar>
    );
  }

  if (approval.asking) {
    return (
      <Bar>
        <ApprovalReasonPrompt
          name={name}
          status={doctor.license_verification_status}
          region={doctor.license_region}
          busy={busy}
          kind={approval.kind}
          onCancel={approval.cancel}
          onConfirm={approval.confirm}
        />
      </Bar>
    );
  }

  if (!doctor.is_active || doctor.is_admin_approved) return null;
  return (
    <Bar>
      <div className="flex items-center justify-between gap-3">
        <span className={toneChip("warn")}>بانتظار القبول</span>
        <button
          type="button"
          disabled={busy}
          onClick={approval.start}
          className="rounded-md border border-success-line bg-success-bg px-4 py-2 text-sm font-medium text-success hover:opacity-90 disabled:opacity-50"
        >
          قبول العضوية
        </button>
      </div>
    </Bar>
  );
}
