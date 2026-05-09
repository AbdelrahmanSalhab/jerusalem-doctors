import { DashboardSearch } from "./DashboardSearch";
import { requireDoctor } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const me = await requireDoctor();

  const service = createSupabaseServiceClient();
  const { data: specialties } = await service
    .from("specialties")
    .select("id, name_ar")
    .eq("is_active", true)
    .order("sort_order");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="text-center">
        <h1 className="text-2xl font-bold sm:text-3xl">
          مرحبًا د. {me.arabic_first_name}
        </h1>
        <p className="mt-1 text-foreground/70">
          ابحث عن طبيب بالاسم، التخصص، أو التخصص الفرعي
        </p>
      </header>

      <DashboardSearch specialties={specialties ?? []} />
    </main>
  );
}
