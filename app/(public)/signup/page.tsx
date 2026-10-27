import { redirect } from "next/navigation";
import { SignupForm } from "./SignupForm";
import { isPhoneAuthDisabled } from "@/lib/auth/session";
import { cachedSpecialties } from "@/lib/cachedReads";
import { SupportContact } from "@/components/SupportContact";
import { readResumeForm } from "@/lib/signup/unfinished";
import { indexable } from "@/lib/site";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export const metadata = indexable("/signup", { title: "إنشاء حساب | دليل أطباء القدس" });

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A reminder's link (/admin/signups) reopens the form as the doctor left it.
  const resume = (await searchParams).resume;
  const resumed =
    typeof resume === "string"
      ? await readResumeForm(createSupabaseServiceClient(), resume).catch((err: unknown) => {
          console.error("[signup] resume read failed", err);
          return null;
        })
      : undefined;

  const { data: specialties, error } = await cachedSpecialties().then(
    (data) => ({ data, error: null }),
    (error: unknown) => ({ data: null, error }),
  );

  if (error) {
    // Migrations not applied yet, surface clearly rather than crashing.
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="mb-4 text-2xl font-bold">دليل أطباء القدس</h1>
        <p className="rounded border border-danger-line bg-danger-bg p-4 text-sm text-danger">
          تعذّر تحميل قائمة التخصصات. الرجاء المحاولة لاحقًا.
        </p>
      </main>
    );
  }

  if (!specialties?.length) {
    redirect("/");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-bold">إنشاء حساب جديد</h1>
      <p className="mb-6 text-foreground/70">
        دليل أطبّاء القدس: منصة مهنية مغلقة
      </p>

      {isPhoneAuthDisabled() && (
        <section className="mb-6 rounded border border-warn-line bg-warn-bg p-4 text-sm">
          <p>
            تسجيل الحسابات قيد الإعداد حاليًا. النموذج سيُفعّل قريبًا. شكرًا
            لصبركم.
          </p>
        </section>
      )}

      {resumed && (
        <p role="status" className="mb-6 rounded border border-info-line bg-info-bg p-4 text-sm text-info">
          فتحنا النموذج كما تركته. راجعه، وافق على الشروط، ثم أرسل لتصلك رسالة التحقق.
        </p>
      )}
      {resumed === null && (
        <p role="status" className="mb-6 rounded border border-warn-line bg-warn-bg p-4 text-sm text-warn">
          انتهت صلاحية هذا الرابط. يمكنك التسجيل من جديد هنا.
        </p>
      )}

      <SignupForm specialties={specialties} initial={resumed ?? undefined} />
      <SupportContact />
    </main>
  );
}
