import { SpecialtiesEditor } from "./SpecialtiesEditor";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function AdminSpecialtiesPage() {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("specialties")
    .select("id, name_ar, name_he, name_en, sort_order, is_active")
    .order("sort_order");

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-bold">التخصصات</h1>
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error.message}
        </p>
      )}
      <SpecialtiesEditor rows={data ?? []} />
    </main>
  );
}
