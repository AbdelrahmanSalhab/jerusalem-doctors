// /admin — the doctors list.
//
// Opens on every doctor, newest first, with the review queue one tab away and
// the waiting rows marked where they sit. It used to open on the queue, which
// answered "who is waiting" but never "who do we have".

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DoctorsList, type DoctorRowData } from "./DoctorsList";
import { DoctorPanelSlot } from "./DoctorPanelSlot";
import { fetchDoctorDetail } from "@/lib/admin/doctorDetail";
import { Tile, TileGrid } from "@/components/AdminParts";
import { countOf, DOCTORS } from "@/lib/arabicCount";
import { requireAdmin } from "@/lib/auth/session";
import {
  ADMIN_PAGE_SIZE,
  adminDoctorsHref,
  DOCTOR_FILTERS,
  pageCount,
  pageRange,
  parseAdminDoctorsParams,
  type DoctorFilter,
} from "@/lib/admin/doctorsQuery";
import { toIlikeTerm } from "@/lib/normalize/arabic";
import { fetchActiveSpecialties } from "@/lib/specialties/catalogue";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const ROW_COLUMNS = `
  id,
  arabic_first_name,
  arabic_family_name,
  phone_e164,
  profile_picture_url,
  license_number,
  license_region,
  license_verification_status,
  secondary_license_number,
  secondary_license_region,
  secondary_license_verification_status,
  career_stage,
  residency_start_year,
  is_admin_approved,
  is_active,
  is_visible,
  is_phone_verified,
  consent_directory_use,
  featured,
  seeking_work,
  retired,
  subspecialty,
  created_at,
  doctor_specialties(specialty:specialties(name_ar))
`;

/** "needs a look": anything short of an exact registry match, nulls included. */
const LICENCE_NEEDS_REVIEW = "license_verification_status.is.null,license_verification_status.neq.verified";

/** Not a non-doctor admin: those rows are hidden on purpose and carry no real
 *  licence, so they would inflate "hidden" and "licence" (admin_stats() leaves
 *  them out the same way). */
const REAL_DOCTOR = "is_admin.eq.false,is_visible.eq.true";

/** Doctors behind each filter, for its box or pill. The same conditions as
 *  the filters, so a number is the length of the list it opens. One head-only count
 *  each, all in parallel. */
async function counts(service: SupabaseClient): Promise<Record<DoctorFilter, number>> {
  const rows = () => service.from("doctors").select("id", { count: "exact", head: true });
  const results = await Promise.all(DOCTOR_FILTERS.map((f) => applyFilter(rows(), f.key)));
  return Object.fromEntries(DOCTOR_FILTERS.map((f, i) => [f.key, results[i].count ?? 0])) as Record<DoctorFilter, number>;
}

function applyFilter<
  T extends { eq: (c: string, v: unknown) => T; or: (f: string) => T; not: (c: string, op: string, v: unknown) => T },
>(
  query: T,
  filter: DoctorFilter,
): T {
  switch (filter) {
    case "pending":
      // Both conditions, matching the header badge and admin_stats(): a closed
      // account is not waiting for anything.
      return query.eq("is_admin_approved", false).eq("is_active", true);
    case "approved":
      return query.eq("is_admin_approved", true);
    case "suspended":
      return query.eq("is_active", false);
    case "hidden":
      return query.eq("is_visible", false).eq("is_active", true).eq("is_admin", false);
    case "license":
      // Both groups inside one or=, so they combine with AND.
      return query.or(`and(or(${LICENCE_NEEDS_REVIEW}),or(${REAL_DOCTOR}))`);
    case "stage":
      // Marked طبيب مقيم, but the registry lists a specialty, which it only
      // does once the board certificate is granted (registry_specialty()).
      return query.eq("career_stage", "resident").not("registry_specialty", "is", null);
    case "clinic":
      // The doctors behind /admin/stats' «عيادة بلا عنوان أو هاتف» count
      // (clinic_missing_details()), without the non-doctor admin rows.
      return query.eq("clinic_missing_details", true).or(REAL_DOCTOR);
    case "all":
      return query;
  }
}

export default async function AdminDoctorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = parseAdminDoctorsParams(await searchParams);
  const service = createSupabaseServiceClient();
  const { from, to } = pageRange(params.page);

  let query = service
    .from("doctors")
    .select(ROW_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    // Ties on created_at would shuffle between pages without this.
    .order("id", { ascending: false })
    .range(from, to);

  query = applyFilter(query, params.filter);

  if (params.q) {
    const term = toIlikeTerm(params.q);
    if (term) {
      const pattern = `*${term}*`;
      query = query.or(
        [
          `arabic_full_name_normalized.ilike.${pattern}`,
          `license_number.ilike.${pattern}`,
          `phone_e164.ilike.${pattern}`,
        ].join(","),
      );
    }
  }

  const [listed, filterCounts, detail, specialties] = await Promise.all([
    query,
    counts(service),
    params.doctorId ? fetchDoctorDetail(service, params.doctorId) : Promise.resolve(null),
    // Only the panel's editor needs the catalogue.
    params.doctorId && params.editing ? fetchActiveSpecialties(service) : Promise.resolve([]),
  ]);

  // Asked for a page past the end, usually by editing the URL or by rows
  // moving under a bookmark.
  if (listed.error?.code === "PGRST103") {
    redirect(adminDoctorsHref({ ...params, page: 1 }));
  }

  const rows = (listed.data ?? []) as unknown as DoctorRowData[];
  const total = listed.count ?? 0;

  const listHref = adminDoctorsHref({ filter: params.filter, q: params.q, page: params.page });

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">الأطباء</h1>
        <p className="text-sm text-muted">
          {listed.error ? "تعذّر تحميل القائمة." : `${countOf(total, DOCTORS)} في هذا التصنيف.`}
        </p>
      </header>

      {/* The main filters, as counts; the rest are pills under the search. */}
      <TileGrid>
        {DOCTOR_FILTERS.filter((f) => "tile" in f).map((f) => (
          <Tile
            key={f.key}
            label={f.label}
            value={filterCounts[f.key]}
            href={adminDoctorsHref({ filter: f.key, q: "", page: 1 })}
            tone={"attention" in f && filterCounts[f.key] > 0 ? "warn" : "plain"}
            current={f.key === params.filter}
          />
        ))}
      </TileGrid>

      <DoctorsList
        rows={rows}
        filter={params.filter}
        counts={filterCounts}
        q={params.q}
        page={params.page}
        pages={pageCount(total, ADMIN_PAGE_SIZE)}
        openDoctorId={params.doctorId}
      />

      {params.doctorId && (
        <DoctorPanelSlot
          detail={detail}
          specialties={specialties}
          editing={params.editing}
          closeHref={listHref}
          viewHref={adminDoctorsHref(params, { doctorId: params.doctorId })}
          editHref={adminDoctorsHref(params, { doctorId: params.doctorId, editing: true })}
        />
      )}
    </main>
  );
}
