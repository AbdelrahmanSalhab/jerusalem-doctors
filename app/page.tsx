import { redirect } from "next/navigation";
import { PublicSearchBar } from "@/components/PublicSearchBar";
import { getCurrentDoctor } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Authenticated doctors land directly on the real search dashboard.
  const doctor = await getCurrentDoctor().catch(() => null);
  if (doctor) redirect("/dashboard");

  return (
    <main className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-6 py-20 text-center">
      <div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          تجمّع أطباء العائلة المقدسي
        </h1>
        <p className="mt-3 text-lg text-foreground/75">
          ابحث عن زملائك من الأطباء المسجلين في القدس
        </p>
      </div>

      <div className="w-full">
        <PublicSearchBar />
      </div>

      <p className="max-w-xl text-sm text-foreground/65">
        منصة مهنية مغلقة — البحث متاح فقط للأطباء المسجلين بعد التحقق من
        أرقام هواتفهم.
      </p>
    </main>
  );
}
