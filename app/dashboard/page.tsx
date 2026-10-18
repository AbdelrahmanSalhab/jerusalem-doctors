import { DashboardSearch } from "./DashboardSearch";
import { fetchFeatured } from "@/lib/directory";
import { requireDoctor } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Started before the auth check so the two don't run back to back; nothing
  // is rendered unless requireDoctor() passes.
  const service = createSupabaseServiceClient();
  const reads = Promise.all([
    service
      .from("specialties")
      .select("id, name_ar, parent_id")
      .eq("is_active", true)
      .order("sort_order"),
    fetchFeatured(service),
  ]);
  const me = await requireDoctor();
  const [{ data: specialties }, featured] = await reads;

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

      {!me.is_admin_approved && !me.is_admin && (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <strong className="font-semibold">حسابك قيد المراجعة.</strong> يمكنك
          البحث في الدليل الآن، لكن اسمك لن يظهر للأطباء الآخرين حتى تتحقق
          الإدارة من ترخيصك.
        </p>
      )}

      <DashboardSearch specialties={specialties ?? []} featured={featured} />
    </main>
  );
}
