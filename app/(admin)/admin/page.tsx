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
import { countOf, DOCTORS } from "@/lib/arabicCount";
import { isSuperAdmin } from "@/lib/auth/superAdmin";
import { requireAdmin } from "@/lib/auth/session";
import {
  ADMIN_PAGE_SIZE,
  adminDoctorsHref,
  DOCTOR_FILTERS,
  pageCount,
  pageRange,
  parseAdminDoctorsParams,
  type AdminDoctorsParams,
  type DoctorFilter,
} from "@/lib/admin/doctorsQuery";
import { toIlikeTerm } from "@/lib/normalize/arabic";
import { fetchActiveSpecialties } from "@/lib/specialties/catalogue";
import type { Tables } from "@/lib/db/database.types";
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
  is_admin,
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
  identity_reviewed_at,
  doctor_specialties(specialty:specialties(name_ar))
`;

/** "needs a look": anything short of an exact registry match, nulls included. */
const LICENCE_NOT_VERIFIED = "license_verification_status.is.null,license_verification_status.neq.verified";
/** ... that no admin has looked at since (doctors.license_reviewed_at): a
 *  Palestinian licence, or one the registry does not list, would otherwise
 *  stay in the queue for good after an admin accepted it. */
const NOT_REVIEWED = "license_reviewed_at.is.null";

/** Not a non-doctor admin: those rows are hidden on purpose and carry no real
 *  licence, so they would inflate "hidden" and "licence" (admin_stats() leaves
 *  them out the same way). */
const REAL_DOCTOR = "is_admin.eq.false,is_visible.eq.true";

/** Doctors behind each filter, for its box or pill. The same conditions as
 *  the filters, so a number is the length of the list it opens. One
 *  head-only count each, all in parallel. */
async function counts(service: SupabaseClient): Promise<Record<DoctorFilter, number>> {
  const rows = () => service.from("doctors").select("id", { count: "exact", head: true });
  const results = await Promise.all(DOCTOR_FILTERS.map((f) => applyFilter(rows(), f.key)));
  return Object.fromEntries(DOCTOR_FILTERS.map((f, i) => [f.key, results[i].count ?? 0])) as Record<DoctorFilter, number>;
}

/** Admins who are not doctors (hidden on purpose): in "all", but not in
 *  admin_stats()'s total, so the two pages differ by this many. */
async function staffCount(service: SupabaseClient): Promise<number> {
  const { count } = await service
    .from("doctors")
    .select("id", { count: "exact", head: true })
    .eq("is_admin", true)
    .eq("is_visible", false);
  return count ?? 0;
}

// Method syntax on purpose: the typed client's eq takes each column's own
// value type, which only a method's (bivariant) parameters accept. The
// column stays checked: it must be a real doctors column.
type DoctorColumn = keyof Tables<"doctors">;
function applyFilter<
  T extends { eq(c: DoctorColumn, v: unknown): T; or(f: string): T; not(c: DoctorColumn, op: string, v: unknown): T },
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
      return query.or(`and(or(${LICENCE_NOT_VERIFIED}),${NOT_REVIEWED},or(${REAL_DOCTOR}))`);
    case "identity":
      // Accepted and open, not yet reviewed, and a real doctor: staff rows have
      // nothing to be who they say.
      // One or=, like the licence filter, so the groups combine with AND.
      return query
        .eq("is_admin_approved", true)
        .eq("is_active", true)
        .or(`and(identity_reviewed_at.is.null,or(${REAL_DOCTOR}))`);
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

/** The doctors list for a filter and search, newest first. The page's own rows, and the
 *  one row beyond its edge that the panel's next and previous reach for (columns "id"). */
function listing(
  service: SupabaseClient,
  params: AdminDoctorsParams,
  columns: string,
  range: { from: number; to: number },
  withCount = false,
) {
  let query = service
    .from("doctors")
    .select(columns, withCount ? { count: "exact" } : undefined)
    .order("created_at", { ascending: false })
    // Ties on created_at would shuffle between pages without this.
    .order("id", { ascending: false })
    .range(range.from, range.to);

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
  return query;
}

export default async function AdminDoctorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdmin();
  const params = parseAdminDoctorsParams(await searchParams);
  const service = createSupabaseServiceClient();
  const { from, to } = pageRange(params.page);

  const query = listing(service, params, ROW_COLUMNS, { from, to }, true);

  const [listed, filterCounts, staff, detail, specialties] = await Promise.all([
    query,
    counts(service),
    staffCount(service),
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

  // The doctors either side of the open one. One just accepted has left a filter such as
  // "waiting", so it is not in the rows any more: the next is then the first row, the first
  // doctor the list still holds. At the edge of a page, the row beyond it is looked up (its id
  // alone), so stepping goes on to the next page and back to the last of the one before.
  const at = rows.findIndex((r) => r.id === params.doctorId);
  const pages = pageCount(total, ADMIN_PAGE_SIZE);
  const edgeId = async (index: number) => {
    const r = await listing(service, params, "id", { from: index, to: index });
    return (r.data as unknown as { id: string }[] | null)?.[0]?.id;
  };
  const [afterId, beforeId] = await Promise.all([
    at >= 0 && at === rows.length - 1 && params.page < pages ? edgeId(to + 1) : undefined,
    at === 0 && params.page > 1 ? edgeId(from - 1) : undefined,
  ]);
  const stepTo = (id: string | undefined, page = params.page) => (id ? adminDoctorsHref({ ...params, page }, { doctorId: id }) : undefined);
  const prevHref = at > 0 ? stepTo(rows[at - 1].id) : stepTo(beforeId, params.page - 1);
  const nextHref = at >= 0 ? (rows[at + 1] ? stepTo(rows[at + 1].id) : stepTo(afterId, params.page + 1)) : stepTo(rows[0]?.id);
  // Where they are in the list, when they are in it.
  const position = at >= 0 ? { n: from + at + 1, of: total } : undefined;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">الأطباء</h1>
        <p className="text-sm text-muted">
          {listed.error ? "تعذّر تحميل القائمة." : `${countOf(total, DOCTORS)} في هذا التصنيف.`}
          {params.filter === "all" && staff > 0 && ` منها ${staff} من الإدارة وليسوا أطباء.`}
        </p>
      </header>

      <DoctorsList
        rows={rows}
        filter={params.filter}
        counts={filterCounts}
        q={params.q}
        page={params.page}
        pages={pages}
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
          prevHref={prevHref}
          nextHref={nextHref}
          position={position}
          canResetSecondFactor={detail?.doctor.is_admin === true && detail.doctor.id !== viewer.id && (await isSuperAdmin(service, viewer.auth_user_id))}
        />
      )}
    </main>
  );
}
