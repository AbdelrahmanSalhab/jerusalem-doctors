"use client";

// The three switches, each saying what it does.
//
// They were two buttons, "إلغاء التفعيل" and "تعليق", which in Arabic both
// read as "deactivate" and left the admin guessing which one they had pressed;
// the third flag was never shown at all. Underneath they are three genuinely
// different things, so they stay three, with the effect of each spelled out
// and one line saying whether the doctor is actually findable right now.

import { useState } from "react";
import { ApprovedNotice } from "./ApprovedNotice";
import { ApprovalReasonPrompt, type PatchResult, type ReasonKind } from "./ApprovalReasonPrompt";
import {
  directoryVisibility,
  STATE_GROUP_HEADING,
  STATE_GROUP_NOTE,
  STATE_SWITCHES,
  switchState,
  type StateField,
  type VisibilityFlags,
} from "@/lib/admin/doctorState";
import { approvalNeedsReason, toneChip } from "@/lib/licenseStatus";

export interface SwitchDoctor extends VisibilityFlags {
  id: string;
  phone_e164: string;
  arabic_first_name: string;
  arabic_family_name: string;
  license_verification_status: string | null;
  license_region: string | null;
}

export function StateSwitches({
  doctor,
  busy,
  onPatch,
}: {
  doctor: SwitchDoctor;
  busy: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<PatchResult>;
}) {
  const [asking, setAsking] = useState(false);
  const [told, setTold] = useState(false);
  const [kind, setKind] = useState<ReasonKind>("unconfirmed");
  const visibility = directoryVisibility(doctor);
  const value = (field: StateField) => doctor[field];

  const toggle = (field: StateField) => {
    const next = !value(field);
    // Accepting an unverified licence opens the prompt at once; any other
    // acceptance asks the server, which answers with the question to put.
    if (field === "is_admin_approved" && next && approvalNeedsReason(doctor.license_verification_status)) {
      setKind("unconfirmed");
      setAsking(true);
      return;
    }
    void onPatch({ [field]: next }).then((r) => {
      if (r === true && field === "is_admin_approved" && next) setTold(true);
      if (typeof r === "object") {
        setKind(r.ask);
        setAsking(true);
      }
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold">{STATE_GROUP_HEADING}</h3>
        <p className="text-sm text-muted">{STATE_GROUP_NOTE}</p>
      </div>

      <ul className="flex flex-col gap-2">
        {STATE_SWITCHES.map((sw) => {
          const on = value(sw.field);
          return (
            <li
              key={sw.field}
              className="grid grid-cols-1 gap-1.5 rounded-lg border border-line bg-background/60 p-3 md:grid-cols-[9rem_8rem_1fr] md:items-center md:gap-3"
            >
              <span className="font-medium">{sw.label}</span>
              <span className="flex items-center gap-2">
                <span
                  className={toneChip(
                    on ? "success" : sw.field === "is_active" ? "danger" : "warn",
                  )}
                >
                  {switchState(sw, on)}
                </span>
              </span>
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted">{sw.hint}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggle(sw.field)}
                  className="shrink-0 rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50"
                >
                  {on ? sw.off : sw.on}
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <p
        className={
          "rounded-md border px-3 py-2 text-sm " +
          (visibility.listed
            ? "border-success-line bg-success-bg text-success"
            : "border-line bg-background/60 text-muted")
        }
      >
        {visibility.sentence}
      </p>

      {told && doctor.is_admin_approved && (
        <ApprovedNotice doctorId={doctor.id} phone={doctor.phone_e164} firstName={doctor.arabic_first_name} listed={visibility.listed} />
      )}

      {asking && (
        <ApprovalReasonPrompt
          name={`${doctor.arabic_first_name} ${doctor.arabic_family_name}`}
          status={doctor.license_verification_status}
          region={doctor.license_region}
          busy={busy}
          kind={kind}
          onCancel={() => setAsking(false)}
          onConfirm={async (reason, method) => {
            const ok = await onPatch({ is_admin_approved: true, approval_reason: reason, approval_method: method });
            if (ok === true) {
              setAsking(false);
              setTold(true);
            }
            return ok === true;
          }}
        />
      )}
    </section>
  );
}
