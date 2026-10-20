"use client";

// The doctors list: filter chips, search, rows, paging.
//
// Two things the old table got wrong, besides its looks. A single
// useTransition disabled every control in every row whenever one of them was
// saving, so the whole table froze on one click; each row now carries its own
// busy state. And a failed save went to window.alert; it now reads inline,
// where the admin is looking.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DoctorListRow } from "./DoctorListRow";
import { adminDoctorsHref, DOCTOR_FILTERS, type DoctorFilter } from "@/lib/admin/doctorsQuery";
import { apiErrorMessage, fieldErrorMessage } from "@/lib/client/apiError";

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
  doctor_specialties: { specialty: { name_ar: string } | { name_ar: string }[] | null }[] | null;
}

export interface Notice {
  ok: boolean;
  text: string;
}

export function DoctorsList({
  rows,
  filter,
  q,
  page,
  pages,
  openDoctorId,
}: {
  rows: DoctorRowData[];
  filter: DoctorFilter;
  q: string;
  page: number;
  pages: number;
  openDoctorId: string | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [navigating, startTransition] = useTransition();

  const here = { filter, q, page };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(() => router.push(adminDoctorsHref({ filter, q: search, page: 1 })));
  };

  /** One row's save. Returns true when it stuck, so a row can close its own
   *  editor only on success. */
  const patchDoctor = async (id: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy((b) => ({ ...b, [id]: true }));
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/doctors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({
          ok: false,
          text: fieldErrorMessage(payload?.fields) ?? apiErrorMessage(payload?.code, "تعذّر حفظ التغيير. حاول مجددًا."),
        });
        return false;
      }
      setNotice({ ok: true, text: "حُفظ التغيير." });
      startTransition(() => router.refresh());
      return true;
    } catch {
      setNotice({ ok: false, text: "تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا." });
      return false;
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const openDoctor = (id: string) => {
    startTransition(() => router.push(adminDoctorsHref(here, { doctorId: id }), { scroll: false }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="تصنيف الأطباء" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {DOCTOR_FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Link
                key={f.key}
                href={adminDoctorsHref({ filter: f.key, q, page: 1 })}
                aria-current={active ? "page" : undefined}
                className={
                  "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors " +
                  (active
                    ? "border-foreground bg-foreground/5 font-semibold"
                    : "border-line bg-surface text-muted hover:border-foreground/40 hover:text-foreground")
                }
              >
                {f.label}
              </Link>
            );
          })}
        </nav>

        <form onSubmit={submitSearch} className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم، الترخيص، أو الهاتف"
            aria-label="بحث في الأطباء"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-base sm:w-64"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md border border-line px-3 py-2 text-sm hover:bg-foreground/5"
          >
            بحث
          </button>
        </form>
      </div>

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
              busy={Boolean(busy[r.id]) || navigating}
              open={r.id === openDoctorId}
              onOpen={() => openDoctor(r.id)}
              onPatch={(body) => patchDoctor(r.id, body)}
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
