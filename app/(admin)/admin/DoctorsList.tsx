"use client";

// The doctors list: one filter bar, search, rows, paging.
//
// Accepting a doctor happens in their panel, where the licence check and the
// rest of what is known about them sit, not on the row: a row only says who is
// waiting and opens that panel. So the list saves nothing itself.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DoctorListRow } from "./DoctorListRow";
import { adminDoctorsHref, DOCTOR_FILTERS, type DoctorFilter } from "@/lib/admin/doctorsQuery";

export interface DoctorRowData {
  id: string;
  arabic_first_name: string;
  arabic_family_name: string;
  phone_e164: string;
  profile_picture_url: string | null;
  license_number: string;
  license_region: "IL" | "PS";
  license_verification_status: string | null;
  secondary_license_number: string | null;
  secondary_license_region: "IL" | "PS" | null;
  secondary_license_verification_status: string | null;
  career_stage: "resident" | "specialist" | null;
  residency_start_year: number | null;
  is_admin: boolean;
  is_admin_approved: boolean;
  is_active: boolean;
  is_visible: boolean;
  is_phone_verified: boolean;
  consent_directory_use: boolean;
  featured: "doctor" | "graduate" | null;
  seeking_work: boolean;
  retired: boolean;
  subspecialty: string | null;
  created_at: string;
  identity_reviewed_at: string | null;
  doctor_specialties: { specialty: { name_ar: string } | { name_ar: string }[] | null }[] | null;
}

/** The queues an admin works through; never hidden, even at 0. */
const QUEUES: ReadonlySet<DoctorFilter> = new Set(["pending", "license", "identity"]);

export function DoctorsList({
  rows,
  filter,
  counts,
  q,
  page,
  pages,
  openDoctorId,
}: {
  rows: DoctorRowData[];
  filter: DoctorFilter;
  /** Doctors behind each filter. */
  counts: Record<DoctorFilter, number>;
  q: string;
  page: number;
  pages: number;
  openDoctorId: string | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const [navigating, startTransition] = useTransition();

  const here = { filter, q, page };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(() => router.push(adminDoctorsHref({ filter, q: search, page: 1 })));
  };

  const openDoctor = (id: string) => {
    startTransition(() => router.push(adminDoctorsHref(here, { doctorId: id }), { scroll: false }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <form onSubmit={submitSearch} className="flex gap-2 sm:max-w-md">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم، الترخيص، أو الهاتف"
            aria-label="بحث في الأطباء"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-base"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md border border-line px-3 py-2 text-sm hover:bg-foreground/5"
          >
            بحث
          </button>
        </form>

        {/* Every filter, as how many doctors it opens. The ones that are work for
            an admin turn amber while they have any. The three review queues are
            always here, so a count that failed to load reads as a 0 you can see;
            the other two are left out while they have none (unless open). Wraps
            rather than scrolling sideways. */}
        <nav aria-label="تصنيفات الأطباء" className="flex flex-wrap gap-1.5">
          {DOCTOR_FILTERS.filter((f) => f.key === filter || !("attention" in f) || QUEUES.has(f.key) || counts[f.key] > 0).map((f) => {
            const active = f.key === filter;
            const n = counts[f.key];
            const waiting = "attention" in f && n > 0;
            return (
              <Link
                key={f.key}
                href={adminDoctorsHref({ filter: f.key, q, page: 1 })}
                aria-current={active ? "page" : undefined}
                className={
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors pointer-coarse:py-3 " +
                  (active
                    ? "border-foreground bg-foreground/5 font-semibold"
                    : waiting
                      ? "border-warn-line bg-warn-bg text-warn hover:border-warn-solid"
                      : "border-line bg-surface text-muted hover:border-foreground/40 hover:text-foreground")
                }
              >
                {f.label}
                <span className={"tabular-nums " + (waiting ? "font-semibold" : "text-xs opacity-70")}>{n}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        <div
          aria-hidden="true"
          className="hidden bg-foreground/5 px-4 py-2.5 text-sm text-muted md:grid md:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] md:gap-3"
        >
          <span>الاسم</span>
          <span>الترخيص</span>
          <span>الحالة</span>
          <span>إجراء</span>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-muted">لا توجد نتائج.</p>
        ) : (
          rows.map((r) => (
            <DoctorListRow
              key={r.id}
              row={r}
              busy={navigating}
              open={r.id === openDoctorId}
              onOpen={() => openDoctor(r.id)}
            />
          ))
        )}
      </div>

      {pages > 1 && (
        <nav aria-label="صفحات الأطباء" className="flex items-center justify-between gap-3 text-sm">
          {page > 1 ? (
            <Link
              href={adminDoctorsHref({ filter, q, page: page - 1 })}
              className="rounded-md border border-line px-3 py-1.5 hover:bg-foreground/5"
            >
              الأحدث
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            صفحة {page} من {pages}
          </span>
          {page < pages ? (
            <Link
              href={adminDoctorsHref({ filter, q, page: page + 1 })}
              className="rounded-md border border-line px-3 py-1.5 hover:bg-foreground/5"
            >
              الأقدم
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
