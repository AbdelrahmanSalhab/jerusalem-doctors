// /admin — the doctors list.
//
// Opens on every doctor, newest first, with the review queue one tab away and
// the waiting rows marked where they sit. It used to open on the queue, which
// answered "who is waiting" but never "who do we have".

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DoctorsList, type DoctorRowData } from "./DoctorsList";
import { DoctorPanel } from "./DoctorPanel";
import { DoctorPanelBody } from "./DoctorPanelBody";
import { Tile, TileGrid } from "@/components/AdminParts";
import { countOf, DOCTORS } from "@/lib/arabicCount";
import { requireAdmin } from "@/lib/auth/session";
import {
  ADMIN_PAGE_SIZE,
  adminDoctorsHref,
  pageCount,
  pageRange,
  parseAdminDoctorsParams,
  type DoctorFilter,
} from "@/lib/admin/doctorsQuery";
import { fetchDoctorDetail } from "@/lib/admin/doctorDetail";
import { toIlikeTerm } from "@/lib/normalize/arabic";
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

/** The tiles above the list, each a shortcut into the matching filter. */
async function counts(service: SupabaseClient) {
  const rows = () => service.from("doctors").select("id", { count: "exact", head: true });

  // The same conditions as the filters they open, so a tile's number is the
  // length of the list behind it.
  const [all, pending, licence, hidden] = await Promise.all([
    rows(),
    applyFilter(rows(), "pending"),
    applyFilter(rows(), "license"),
    applyFilter(rows(), "hidden"),
  ]);
  return {
    all: all.count ?? 0,
    pending: pending.count ?? 0,
    licence: licence.count ?? 0,
    hidden: hidden.count ?? 0,
  };
}

function applyFilter<T extends { eq: (c: string, v: unknown) => T; or: (f: string) => T }>(
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

  const [listed, tiles, detail] = await Promise.all([
    query,
    counts(service),
    params.doctorId ? fetchDoctorDetail(service, params.doctorId) : Promise.resolve(null),
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

      <TileGrid>
        <Tile label="كل الأطباء" value={tiles.all} href={adminDoctorsHref({ filter: "all", q: "", page: 1 })} />
        <Tile
          label="بانتظار القبول"
          value={tiles.pending}
          href={adminDoctorsHref({ filter: "pending", q: "", page: 1 })}
          tone={tiles.pending > 0 ? "warn" : "plain"}
        />
        <Tile
          label="ترخيص يحتاج مراجعة"
          value={tiles.licence}
          href={adminDoctorsHref({ filter: "license", q: "", page: 1 })}
          tone={tiles.licence > 0 ? "warn" : "plain"}
        />
        <Tile label="مخفي من الدليل" value={tiles.hidden} href={adminDoctorsHref({ filter: "hidden", q: "", page: 1 })} />
      </TileGrid>

      <DoctorsList
        rows={rows}
        filter={params.filter}
        q={params.q}
        page={params.page}
        pages={pageCount(total, ADMIN_PAGE_SIZE)}
        openDoctorId={params.doctorId}
      />

      {params.doctorId && (
        <DoctorPanel
          closeHref={listHref}
          title={detail ? `د. ${detail.doctor.arabic_first_name} ${detail.doctor.arabic_family_name}` : "الطبيب"}
        >
          {detail ? (
            <DoctorPanelBody detail={detail} closeHref={listHref} />
          ) : (
            <p className="text-sm text-muted">هذا الحساب غير موجود (ربما حُذف).</p>
          )}
        </DoctorPanel>
      )}
    </main>
  );
}
