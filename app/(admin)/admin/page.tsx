import { AdminDoctorsTable } from "./AdminDoctorsTable";
import { toIlikeTerm } from "@/lib/normalize/arabic";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

interface SearchParams {
  status?: "pending" | "approved" | "all";
  q?: string;
}

export default async function AdminDoctorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const status = sp.status ?? "pending";
  const q = sp.q?.trim() ?? "";

  // The (admin) layout's check alone is not enough: Next can render this
  // page without re-running the layout. requireAdmin is request-cached.
  await requireAdmin();
  const service = createSupabaseServiceClient();
  let query = service
    .from("doctors")
    .select(
      "id, arabic_first_name, arabic_family_name, phone_e164, license_number, license_region, secondary_license_number, secondary_license_region, secondary_license_verification_status, license_verification_status, career_stage, residency_start_year, is_admin_approved, is_active, is_visible, featured, seeking_work, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (status === "pending") query = query.eq("is_admin_approved", false);
  if (status === "approved") query = query.eq("is_admin_approved", true);
  // Stored names are normalized (إ/أ/آ to ا), so the typed text must be too.
  const term = toIlikeTerm(q);
  if (term) {
    query = query.or(
      [
        `arabic_full_name_normalized.ilike.*${term}*`,
        `license_number.ilike.*${term}*`,
        `phone_e164.ilike.*${term}*`,
      ].join(","),
    );
  }

  const { data, error } = await query;

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-bold">الأطباء</h1>
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          خطأ في القراءة: {error.message}
        </p>
      )}
      <AdminDoctorsTable
        rows={data ?? []}
        currentStatus={status}
        currentQ={q}
      />
    </main>
  );
}
