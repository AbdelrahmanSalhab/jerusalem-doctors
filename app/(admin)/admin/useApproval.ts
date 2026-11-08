"use client";

// Accepting a doctor, as one flow shared by the sticky bar and the switch: ask
// the server, which says whether a reason is wanted and which question to put,
// open the prompt if so, and remember that the doctor has just been let in so
// the message to send them can be offered.

import { useState } from "react";
import type { PatchResult, ReasonKind } from "./ApprovalReasonPrompt";
import type { ApprovalMethod } from "@/lib/admin/approvalMethods";
import { approvalNeedsReason } from "@/lib/licenseStatus";

export function useApproval(status: string | null, onPatch: (body: Record<string, unknown>) => Promise<PatchResult>) {
  const [asking, setAsking] = useState(false);
  const [told, setTold] = useState(false);
  const [kind, setKind] = useState<ReasonKind>("unconfirmed");

  /** An unverified licence opens the prompt at once; any other acceptance asks
   *  the server first, which knows whether a number was set by hand. */
  const start = () => {
    // Accepted before and let go again: this is a new acceptance.
    setTold(false);
    if (approvalNeedsReason(status)) {
      setKind("unconfirmed");
      setAsking(true);
      return;
    }
    void onPatch({ is_admin_approved: true }).then((r) => {
      if (r === true) setTold(true);
      if (typeof r === "object") {
        setKind(r.ask);
        setAsking(true);
      }
    });
  };

  const confirm = async (reason: string, method: ApprovalMethod) => {
    const ok = await onPatch({ is_admin_approved: true, approval_reason: reason, approval_method: method });
    if (ok === true) {
      setAsking(false);
      setTold(true);
    }
    return ok === true;
  };

  return { asking, told, kind, start, cancel: () => setAsking(false), confirm };
}

export type Approval = ReturnType<typeof useApproval>;
