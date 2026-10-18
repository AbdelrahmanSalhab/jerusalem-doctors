import { InstitutionsEditor } from "./InstitutionsEditor";
import { requireAdmin } from "@/lib/auth/session";
import { fetchInstitutions, institutionUsage } from "@/lib/institutions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function AdminInstitutionsPage() {
  // The (admin) layout's check alone is not enough: Next can render this
  // page without re-running the layout. requireAdmin is request-cached.
  await requireAdmin();
  const service = createSupabaseServiceClient();
  const [institutions, usage] = await Promise.all([
    fetchInstitutions(service),
    institutionUsage(service),
  ]);

  return (
    <main className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">المستشفيات وصناديق المرضى</h1>
        <p className="mt-1 max-w-3xl text-sm text-foreground/65">
          يكتب الطبيب مكان عمله بحرية، ويُربط تلقائيًا بالمؤسسة إذا احتوى اسمه على أحد أسمائها أو
          طرق كتابتها. هكذا تُحسب «شعاري تسيدك» مرة واحدة مهما كُتبت، ويجدها البحث بأي كتابة. أي
          تعديل هنا يُطبَّق على كل الأطباء فورًا، وفحص يومي يرسل للمطوّرين الأسماء غير المربوطة.
        </p>
      </header>
      <InstitutionsEditor institutions={institutions} doctors={usage.doctors} unmatched={usage.unmatched} />
    </main>
  );
}
