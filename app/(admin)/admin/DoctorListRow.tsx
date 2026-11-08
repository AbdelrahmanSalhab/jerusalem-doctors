"use client";

// One doctor in the list. Stacks on a phone, goes to columns from md up, the
// same shape components/DoctorRow.tsx uses on the doctor-facing side.
//
// The name is the button that opens the panel, not the whole row: the row also
// carries a button of its own, and a button inside a button is invalid markup.
//
// A waiting doctor's button opens the same panel: accepting is a decision to
// take with the licence check and the rest of the record in front of the admin
// (#16), so the row never accepts on its own.

import { Avatar } from "@/components/Avatar";
import type { DoctorRowData } from "./DoctorsList";
import { directoryVisibility, staffKind } from "@/lib/admin/doctorState";
import { careerStageBadge } from "@/lib/careerStage";
import { licenseDisplay, toneChip } from "@/lib/licenseStatus";

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
}: {
  row: DoctorRowData;
  busy: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  const name = `${row.arabic_first_name} ${row.arabic_family_name}`;
  const licence = licenseDisplay({ status: row.license_verification_status, region: row.license_region });
  const stage = row.career_stage ? careerStageBadge(row.career_stage, row.residency_start_year) : "طب عام";
  const visibility = directoryVisibility(row);
  const waiting = !row.is_admin_approved && row.is_active;
  // Staff and the CI account carry placeholder doctor fields: say what they
  // are instead of «د.», a stage and a licence nobody holds.
  const staff = staffKind(row);

  return (
    <div
      className={
        "flex flex-col gap-2 px-4 py-3 transition-colors md:grid md:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] md:items-center md:gap-3 " +
        (open ? "bg-foreground/5" : waiting ? "bg-warn-bg/40 hover:bg-warn-bg/60" : "hover:bg-foreground/[0.03]")
      }
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* A waiting doctor's photo is theirs to choose and not yet vetted: initials until accepted. */}
        <Avatar url={row.is_admin_approved ? row.profile_picture_url : null} fallback={row.arabic_first_name} size="sm" />
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            aria-expanded={open}
            className="truncate text-start font-medium underline-offset-4 hover:underline"
          >
            {staff ? name : `د. ${name}`}
          </button>
          <p className="truncate text-xs text-muted">
            {staff === "ci" ? (
              "يسجّل به فحص الإنتاج الآلي الدخول، بلا كلمة مرور"
            ) : staff === "staff" ? (
              <>
                <span dir="ltr">{row.phone_e164}</span> · فريق الإدارة
              </>
            ) : (
              <>
                <span dir="ltr">{row.phone_e164}</span>
                {stage && <> · {stage}</>}
                {specialtyNames(row).length > 0 && <> · {specialtyNames(row).join("، ")}</>}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted md:hidden">الترخيص:</span>
        {staff ? (
          <span className="text-muted">لا ينطبق</span>
        ) : (
          <>
            <span dir="ltr" className="tabular-nums">
              {row.license_number}
            </span>
            <span className={toneChip(licence.tone)}>{licence.label}</span>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted md:hidden">الحالة:</span>
        {waiting && <span className={toneChip("warn")}>بانتظار القبول</span>}
        {!row.is_active && <span className={toneChip("danger")}>الحساب مغلق</span>}
        {staff === "ci" && <span className={toneChip("neutral")}>حساب آلي (CI)</span>}
        {staff === "staff" && <span className={toneChip("neutral")}>حساب إدارة</span>}
        {/* Staff are hidden by design, not by a decision to look into. */}
        {!staff && row.is_active && row.is_admin_approved && !row.is_visible && (
          <span className={toneChip("warn")}>مخفي من الدليل</span>
        )}
        {visibility.listed && <span className={toneChip("success")}>في الدليل</span>}
        {/* Accepted on a registry match alone: no admin has satisfied themselves it is them (#16). */}
        {!staff && row.is_active && row.is_admin_approved && !row.identity_reviewed_at && (
          <span className={toneChip("warn")}>لم تُراجَع هويته</span>
        )}
        {row.seeking_work && <span className={toneChip("neutral")}>يبحث عن عمل</span>}
        {row.retired && <span className={toneChip("neutral")}>طبيب متقاعد</span>}
      </div>

      <div className="flex items-center gap-2 md:justify-end">
        {waiting ? (
          <button
            type="button"
            disabled={busy}
            onClick={onOpen}
            className="rounded-md border border-success-line bg-success-bg px-3 py-1.5 text-sm text-success hover:opacity-90 disabled:opacity-50 pointer-coarse:py-2.5"
          >
            مراجعة وقبول
          </button>
        ) : (
          <>
            <span className="text-xs text-muted">انضمّ {joinedOn(row.created_at)}</span>
            <button
              type="button"
              onClick={onOpen}
              className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-foreground/5 pointer-coarse:py-2.5"
            >
              التفاصيل
            </button>
          </>
        )}
      </div>
    </div>
  );
}
