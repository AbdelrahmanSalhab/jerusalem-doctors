import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentDoctor } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// What a doctor does, in order. The order is the point, so it's numbered.
const STEPS = [
  { title: "سجّل برقم هاتفك ورقم الترخيص", text: "دقيقتان، ورمز تحقق برسالة نصية. لا كلمة سر." },
  { title: "نراجع طلبك", text: "كل طلب يُراجع قبل تفعيله. الدليل مغلق على الأطباء وحدهم." },
  { title: "ابحث وتواصل مع زملائك", text: "بالاسم أو التخصص أو مكان العمل، واتصل أو راسل عبر واتساب مباشرة." },
];

export default async function HomePage() {
  // Signed-in doctors land directly on the search.
  const doctor = await getCurrentDoctor().catch(() => null);
  if (doctor) redirect("/dashboard");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-14 sm:py-20">
      <section className="flex flex-col items-center gap-5 text-center">
        <h1 className="text-balance text-3xl font-bold sm:text-5xl">دليل أطبّاء القدس</h1>
        <p className="max-w-xl text-pretty text-lg text-muted sm:text-xl">
          دليل مهني مغلق يجمع أطباء القدس: اعرف من يعمل أين، وتواصل مع الزميل المناسب بضغطة.
        </p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/signup"
            className="rounded-md bg-primary px-6 py-3 text-center font-semibold text-primary-fg hover:opacity-90"
          >
            إنشاء حساب
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-line bg-surface px-6 py-3 text-center hover:bg-foreground/5"
          >
            لدي حساب، تسجيل الدخول
          </Link>
        </div>
      </section>

      <section aria-labelledby="how" className="flex flex-col gap-4">
        <h2 id="how" className="text-center text-lg font-semibold">كيف يعمل</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-4">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-fg">
                {i + 1}
              </span>
              <span className="font-semibold">{s.title}</span>
              <span className="text-sm text-muted">{s.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-center text-sm text-muted">
        البحث والبيانات متاحة للأطباء المسجّلين فقط، ولا تظهر لأي شخص من خارج المنصة.{" "}
        <Link href="/privacy" className="underline hover:text-foreground">
          الخصوصية
        </Link>
      </p>
    </main>
  );
}
