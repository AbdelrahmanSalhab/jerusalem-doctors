import Link from "next/link";
import type { DoctorWorkplace } from "@/lib/db/types";
import { ProfileReminder } from "@/components/ProfileReminder";
import { InstallInvite } from "@/components/install/InstallInvite";
import { DashboardSearch } from "./DashboardSearch";
import { searchFromParams } from "@/lib/searchFilters";
import { ViewerProvider } from "@/components/ViewerContext";
import { cachedDirectoryOverview, cachedInstitutions, cachedSpecialties } from "@/lib/cachedReads";
import { rankRecent } from "@/lib/directory";
import { requireDoctor } from "@/lib/auth/session";
import { profileGaps } from "@/lib/profile/reminders";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Signup with a phone that already has an account signs its owner in
  // (signup/verify); /verify sends them here with ?existing=1 to say so.
  const sp = await searchParams;
  const existing = sp.existing === "1";
  // The search the URL carries (#177), so back from a card lands on the results.
  const initialSearch = searchFromParams(
    new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))),
  );
  // Started before the auth check so the two don't run back to back; nothing
  // is rendered unless requireDoctor() passes. What every doctor sees the
  // same (specialties, featured doctors, counts) comes from the cache
  // (lib/cachedReads.ts); only this doctor's own rows are read each time.
  const service = createSupabaseServiceClient();
  const reads = Promise.all([cachedSpecialties(), cachedDirectoryOverview(), cachedInstitutions()]);
  const me = await requireDoctor();
  const [
    [specialties, { featured, counts, recent }, allInstitutions],
    { data: myWorkplaces },
    { data: mySpecialties },
  ] =
    await Promise.all([
      reads,
      service
        .from("doctor_workplaces")
        .select("name, workplace_type, address, phone, is_primary, sort_order, institution_id")
        .eq("doctor_id", me.id),
      service.from("doctor_specialties").select("specialty_id").eq("doctor_id", me.id),
    ]);
  // How this doctor introduces themselves in a WhatsApp message.
  const specialtyName = (id: string) => specialties?.find((s) => s.id === id)?.name_ar;
  const primary = [...(myWorkplaces ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order,
  )[0];
  const viewer = {
    id: me.id,
    firstName: me.arabic_first_name,
    familyName: me.arabic_family_name,
    specialty:
      me.career_stage === null
        ? "طب عام"
        : (mySpecialties ?? []).map((r) => specialtyName(r.specialty_id)).filter(Boolean).join(" و") || null,
    workplace: primary?.name ?? null,
  };
  // «جديد هذا الأسبوع»: colleagues in my specialty area or at my hospital
  // or fund first.
  const domainOfId = (id: string) => {
    const s = specialties.find((x) => x.id === id);
    return s ? (s.parent_id ?? s.id) : undefined;
  };
  const domainByName = new Map(specialties.map((s) => [s.name_ar, s.parent_id ?? s.id]));
  const newThisWeek = rankRecent(
    recent,
    {
      id: me.id,
      domains: new Set((mySpecialties ?? []).map((r) => domainOfId(r.specialty_id)).filter((x): x is string => !!x)),
      institutions: new Set((myWorkplaces ?? []).map((w) => w.institution_id).filter((x): x is string => !!x)),
    },
    (name) => domainByName.get(name),
  );
  // Staff accounts (admin, hidden from the directory) have no card to improve.
  const gaps =
    me.is_admin && !me.is_visible
      ? []
      : // workplace_type is text in SQL, limited by a check to WorkplaceType.
        profileGaps(me, (myWorkplaces ?? []) as Pick<DoctorWorkplace, "name" | "workplace_type" | "address" | "phone">[]);

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

      {existing && (
        <p role="status" className="rounded-md border border-info-line bg-info-bg p-4 text-sm text-info">
          <strong className="font-semibold">هذا الرقم مسجَّل مسبقًا.</strong> أدخلناك إلى حسابك
          بدل إنشاء حساب جديد. ليس حسابك؟{" "}
          <Link href="/report" className="font-semibold underline">
            أبلغ الإدارة
          </Link>
        </p>
      )}

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

      <InstallInvite />

      {gaps.length > 0 && <ProfileReminder gaps={gaps} />}

      <ViewerProvider viewer={viewer}>
        <DashboardSearch
          specialties={specialties ?? []}
          initial={initialSearch}
          featured={featured}
          listed={counts.listed}
          domainCounts={counts.byDomain}
          recent={newThisWeek}
          institutions={allInstitutions
            .filter((i) => counts.byInstitution[i.id])
            .map((i) => ({ id: i.id, name_ar: i.name_ar, kind: i.kind, count: counts.byInstitution[i.id] }))}
        />
      </ViewerProvider>
    </main>
  );
}
