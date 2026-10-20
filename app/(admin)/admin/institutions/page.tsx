import { InstitutionsEditor } from "./InstitutionsEditor";
import { DoctorPanelSlot } from "../DoctorPanelSlot";
import { requireAdmin } from "@/lib/auth/session";
import { fetchDoctorDetail } from "@/lib/admin/doctorDetail";
import { panelHref, readDoctorParam, readEditParam, type RawParams } from "@/lib/admin/doctorsQuery";
import { fetchActiveSpecialties } from "@/lib/specialties/catalogue";
import { fetchInstitutions, institutionUsage } from "@/lib/institutions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Closing the panel comes back to this tab, not to the doctors list: an
 *  admin working through the unlinked names should keep their place. */
const CLOSE_HREF = "/admin/institutions";

export default async function AdminInstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  // The (admin) layout's check alone is not enough: Next can render this
  // page without re-running the layout. requireAdmin is request-cached.
  await requireAdmin();
  const sp = await searchParams;
  const doctorId = readDoctorParam(sp);
  const editing = readEditParam(sp);
  const service = createSupabaseServiceClient();
  const [institutions, usage, detail, specialties] = await Promise.all([
    fetchInstitutions(service),
    institutionUsage(service),
    doctorId ? fetchDoctorDetail(service, doctorId) : Promise.resolve(null),
    doctorId && editing ? fetchActiveSpecialties(service) : Promise.resolve([]),
  ]);

  return (
    <main className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">المستشفيات وصناديق المرضى</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          يكتب الطبيب مكان عمله بحرية، ويُربط تلقائيًا بالمؤسسة إذا احتوى اسمه على أحد أسمائها أو
          طرق كتابتها. هكذا تُحسب «شعاري تسيدك» مرة واحدة مهما كُتبت، ويجدها البحث بأي كتابة. أي
          تعديل هنا يُطبَّق على كل الأطباء فورًا، وفحص يومي يرسل للمطوّرين الأسماء غير المربوطة.
          الأسماء غير المربوطة تحمل أسماء من كتبها: افتح الطبيب لتصحيح ما كتبه.
        </p>
      </header>
      <InstitutionsEditor institutions={institutions} doctors={usage.doctors} unmatched={usage.unmatched} />

      {doctorId && (
        <DoctorPanelSlot
          detail={detail}
          specialties={specialties}
          editing={editing}
          closeHref={CLOSE_HREF}
          viewHref={panelHref(CLOSE_HREF, doctorId)}
          editHref={panelHref(CLOSE_HREF, doctorId, { edit: true })}
        />
      )}
    </main>
  );
}
