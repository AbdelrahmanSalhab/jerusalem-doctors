// Stub dashboard — Phase 3 builds the real search UI here.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="mb-2 text-3xl font-bold">دليل أطباء القدس</h1>
      <p className="mb-6 text-foreground/70">
        ابحث عن طبيب بالاسم، التخصص، أو التخصص الفرعي
      </p>
      <p className="rounded border border-foreground/15 bg-foreground/5 p-6 text-sm text-foreground/80">
        تم تأكيد دخولك. شاشة البحث تُبنى في المرحلة الثالثة.
      </p>
      <form action="/api/auth/logout" method="post" className="mt-6">
        <button className="rounded-md border border-foreground px-6 py-2 text-sm">
          تسجيل الخروج
        </button>
      </form>
    </main>
  );
}
