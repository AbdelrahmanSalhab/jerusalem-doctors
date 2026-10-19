import Link from "next/link";
import { DashboardSearch } from "./DashboardSearch";
import { fetchFeatured } from "@/lib/directory";
import { requireDoctor } from "@/lib/auth/session";
import { profileGaps } from "@/lib/profile/reminders";
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
  const [[{ data: specialties }, featured], { data: myWorkplaces }] = await Promise.all([
    reads,
    service
      .from("doctor_workplaces")
      .select("name, workplace_type, address, phone")
      .eq("doctor_id", me.id),
  ]);
  // Staff accounts (admin, hidden from the directory) have no card to improve.
  const gaps = me.is_admin && !me.is_visible ? [] : profileGaps(me, myWorkplaces ?? []);

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
          className="rounded-md border border-warn-line bg-warn-bg p-4 text-sm text-warn"
        >
          <strong className="font-semibold">حسابك قيد المراجعة.</strong> يمكنك
          البحث في الدليل الآن، لكن اسمك لن يظهر للأطباء الآخرين حتى تتحقق
          الإدارة من ترخيصك.
        </p>
      )}

      {gaps.length > 0 && (
        <section
          aria-label="أكمل ملفك"
          className="flex flex-col gap-2 rounded-md border border-info-line bg-info-bg p-4 text-sm text-info sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-semibold">أكمل ملفك ليسهل على الزملاء الوصول إليك</p>
            <ul className="mt-1 list-disc ps-5">
              {gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
          <Link
            href="/profile"
            className="shrink-0 rounded-md bg-primary px-4 py-2 text-center text-primary-fg hover:opacity-90"
          >
            إكمال الملف
          </Link>
        </section>
      )}

      <DashboardSearch specialties={specialties ?? []} featured={featured} />
    </main>
  );
}
