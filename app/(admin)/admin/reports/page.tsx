import { ReportsList, type ReportRow } from "./ReportsList";
import { auditTime } from "@/lib/auditText";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type Doc = { id: string; arabic_full_name: string; phone_e164: string } | null;
/** A to-one embed, typed as a list by the untyped client. */
const one = (d: Doc | Doc[]): Doc => (Array.isArray(d) ? (d[0] ?? null) : d);

/** Open profile reports, oldest first (lib/reports.ts). */
export default async function AdminReportsPage() {
  // The (admin) layout's check alone is not enough: Next can render this
  // page without re-running the layout. requireAdmin is request-cached.
  await requireAdmin();
  const { data, error } = await createSupabaseServiceClient()
    .from("profile_reports")
    .select(
      `id, source, license_number, reporter_name, reporter_contact, details, created_at,
       target:doctors!target_doctor_id(id, arabic_full_name, phone_e164),
       reporter:doctors!reporter_doctor_id(id, arabic_full_name, phone_e164)`,
    )
    .is("resolved_at", null)
    .order("created_at");

  const rows: ReportRow[] = (data ?? []).map((r) => {
    const target = one(r.target as Doc | Doc[]);
    const reporter = one(r.reporter as Doc | Doc[]);
    return {
      id: r.id,
      at: auditTime(r.created_at),
      fromCard: r.source === "card",
      target: target ? { id: target.id, name: target.arabic_full_name } : null,
      license: r.license_number,
      reporter: reporter
        ? { name: reporter.arabic_full_name, contact: reporter.phone_e164 }
        : { name: r.reporter_name ?? "", contact: r.reporter_contact ?? "" },
      details: r.details,
    };
  });

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-bold">البلاغات</h1>
      <p className="text-sm text-muted">
        بلاغات بأن ملفًا لا يخص صاحبه. لا يُعلَّق أي حساب تلقائيًا: افتح الملف، قارنه بسجل الوزارة، تواصل مع
        المُبلِّغ وصاحب الملف، ثم أغلق البلاغ بملاحظة عمّا فعلت.
      </p>
      {error && (
        <p className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">{error.message}</p>
      )}
      <ReportsList rows={rows} />
    </main>
  );
}
