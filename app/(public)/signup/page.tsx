import { redirect } from "next/navigation";
import { SignupForm } from "./SignupForm";
import { isPhoneAuthDisabled } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const service = createSupabaseServiceClient();
  const { data: specialties, error } = await service
    .from("specialties")
    .select("id, name_ar")
    .eq("is_active", true)
    .order("sort_order");

  if (error) {
    // Migrations not applied yet — surface clearly rather than crashing.
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="mb-4 text-2xl font-bold">دليل أطباء القدس</h1>
        <p className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
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
        دليل أطباء القدس — منصة مهنية مغلقة
      </p>

      {isPhoneAuthDisabled() && (
        <section className="mb-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p>
            تسجيل الحسابات قيد الإعداد حاليًا. النموذج سيُفعّل قريبًا. شكرًا
            لصبركم.
          </p>
        </section>
      )}

      <section className="mb-8 rounded border border-foreground/15 bg-foreground/5 p-5 text-sm leading-relaxed">
        <h2 className="mb-2 font-semibold">تنبيه مهم قبل التسجيل</h2>
        <p className="mb-2">
          المعلومات التي ستدخلها في هذا النموذج، بما في ذلك الاسم، رقم الهاتف،
          رقم الترخيص، والتخصص، ستُستخدم لمساعدة الأطباء الآخرين في القدس على
          العثور عليك والتواصل معك بسهولة لأغراض مهنية.
        </p>
        <p className="mb-2">
          لن يتم عرض هذه المعلومات للعامة، بل فقط للأطباء المسجلين والمتحقق من
          رقم هاتفهم داخل النظام.
        </p>
        <p>
          بالضغط على &quot;أوافق&quot;، أنت تؤكد أنك طبيب/ة، وأن المعلومات
          المدخلة صحيحة، وأنك توافق على استخدامها داخل دليل أطباء القدس لهذا
          الغرض المهني.
        </p>
      </section>

      <SignupForm specialties={specialties} />
    </main>
  );
}
