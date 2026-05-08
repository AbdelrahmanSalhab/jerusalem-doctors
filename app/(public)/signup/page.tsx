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
        دليل أطبّاء القدس — منصة مهنية مغلقة
      </p>

      {isPhoneAuthDisabled() && (
        <section className="mb-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p>
            تسجيل الحسابات قيد الإعداد حاليًا. النموذج سيُفعّل قريبًا. شكرًا
            لصبركم.
          </p>
        </section>
      )}

      <SignupForm specialties={specialties} />
    </main>
  );
}
