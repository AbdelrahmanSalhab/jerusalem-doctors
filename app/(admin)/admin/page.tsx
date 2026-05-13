import { AdminDoctorsTable } from "./AdminDoctorsTable";
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

  const service = createSupabaseServiceClient();
  let query = service
    .from("doctors")
    .select(
      "id, arabic_first_name, arabic_family_name, phone_e164, license_number, email, email_domain, email_is_institutional, email_verified_at, license_verification_status, is_admin_approved, is_active, user_chose_visible, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (status === "pending") query = query.eq("is_admin_approved", false);
  if (status === "approved") query = query.eq("is_admin_approved", true);
  if (q) {
    query = query.or(
      [
        `arabic_full_name_normalized.ilike.*${q}*`,
        `license_number.ilike.*${q}*`,
        `phone_e164.ilike.*${q}*`,
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
