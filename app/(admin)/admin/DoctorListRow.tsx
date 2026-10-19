"use client";

// One doctor in the list. Stacks on a phone, goes to columns from md up, the
// same shape components/DoctorRow.tsx uses on the doctor-facing side.
//
// The name is the button that opens the panel, not the whole row: the row also
// carries the accept action, and a button inside a button is invalid markup.

import { Avatar } from "@/components/Avatar";
import { ApprovalReasonPrompt } from "./ApprovalReasonPrompt";
import type { DoctorRowData } from "./DoctorsList";
import { directoryVisibility } from "@/lib/admin/doctorState";
import { careerStageBadge } from "@/lib/careerStage";
import { approvalNeedsReason, licenseDisplay, toneChip } from "@/lib/licenseStatus";
import { useState } from "react";

function specialtyNames(row: DoctorRowData): string[] {
  return (row.doctor_specialties ?? [])
    .flatMap((r) => (Array.isArray(r.specialty) ? r.specialty : r.specialty ? [r.specialty] : []))
    .map((s) => s.name_ar)
    .filter(Boolean);
}

/** "19/10/2026" in Jerusalem time. */
function joinedOn(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export function DoctorListRow({
  row,
  busy,
  open,
  onOpen,
  onPatch,
}: {
  row: DoctorRowData;
  busy: boolean;
  open: boolean;
  onOpen: () => void;
  onPatch: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [asking, setAsking] = useState(false);
  const name = `${row.arabic_first_name} ${row.arabic_family_name}`;
  const licence = licenseDisplay({ status: row.license_verification_status, region: row.license_region });
  const stage = row.career_stage ? careerStageBadge(row.career_stage, row.residency_start_year) : "طب عام";
  const visibility = directoryVisibility(row);
  const waiting = !row.is_admin_approved && row.is_active;

  // An exact registry match needs no explanation; anything else is a
  // judgement call, including a Palestinian licence, which is unverifiable by
  // design rather than suspect.
  const accept = () => {
    if (approvalNeedsReason(row.license_verification_status)) setAsking(true);
    else void onPatch({ is_admin_approved: true });
  };

  return (
    <div
      className={
        "flex flex-col gap-2 px-4 py-3 transition-colors md:grid md:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] md:items-center md:gap-3 " +
        (open ? "bg-foreground/5" : waiting ? "bg-warn-bg/40 hover:bg-warn-bg/60" : "hover:bg-foreground/[0.03]")
      }
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar url={row.profile_picture_url} fallback={row.arabic_first_name} size="sm" />
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            aria-expanded={open}
            className="truncate text-start font-medium underline-offset-4 hover:underline"
          >
            د. {name}
          </button>
          <p className="truncate text-xs text-muted">
            <span dir="ltr">{row.phone_e164}</span>
            {stage && <> · {stage}</>}
            {specialtyNames(row).length > 0 && <> · {specialtyNames(row).join("، ")}</>}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted md:hidden">الترخيص:</span>
        <span dir="ltr" className="tabular-nums">
          {row.license_number}
        </span>
        <span className={toneChip(licence.tone)}>{licence.label}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted md:hidden">الحالة:</span>
        {waiting && <span className={toneChip("warn")}>بانتظار القبول</span>}
        {!row.is_active && <span className={toneChip("danger")}>الحساب مغلق</span>}
        {row.is_active && row.is_admin_approved && !row.is_visible && (
          <span className={toneChip("warn")}>مخفي من الدليل</span>
        )}
        {visibility.listed && <span className={toneChip("success")}>في الدليل</span>}
        {row.seeking_work && <span className={toneChip("neutral")}>يبحث عن عمل</span>}
      </div>

      <div className="flex items-center gap-2 md:justify-end">
        {waiting ? (
          <button
            type="button"
            disabled={busy}
            onClick={accept}
            className="rounded-md border border-success-line bg-success-bg px-3 py-1.5 text-sm text-success hover:opacity-90 disabled:opacity-50"
          >
            قبول العضوية
          </button>
        ) : (
          <span className="text-xs text-muted">انضمّ {joinedOn(row.created_at)}</span>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-foreground/5"
        >
          التفاصيل
        </button>
      </div>

      {asking && (
        <div className="md:col-span-4">
          <ApprovalReasonPrompt
            name={name}
            status={row.license_verification_status}
            region={row.license_region}
            busy={busy}
            onCancel={() => setAsking(false)}
            onConfirm={async (reason) => {
              const ok = await onPatch({ is_admin_approved: true, ...(reason ? { approval_reason: reason } : {}) });
              if (ok) setAsking(false);
              return ok;
            }}
          />
        </div>
      )}
    </div>
  );
}
