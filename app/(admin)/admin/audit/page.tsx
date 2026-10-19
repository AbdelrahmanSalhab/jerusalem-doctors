import { requireAdmin } from "@/lib/auth/session";
import { auditDetail, auditTime, auditTitle } from "@/lib/auditText";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  action: string;
  actor_doctor_id: string | null;
  target_doctor_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default async function AdminAuditPage() {
  // The (admin) layout's check alone is not enough: Next can render this
  // page without re-running the layout. requireAdmin is request-cached.
  await requireAdmin();
  const service = createSupabaseServiceClient();
  const [{ data, error }, { data: institutions }] = await Promise.all([
    service
      .from("audit_logs")
      .select("id, action, actor_doctor_id, target_doctor_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    service.from("institutions").select("id, name_ar"),
  ]);
  const rows = (data ?? []) as Row[];

  // Names instead of ids, for whoever acted and whoever it concerned.
  const ids = [...new Set(rows.flatMap((r) => [r.actor_doctor_id, r.target_doctor_id]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: docs } = await service
      .from("doctors")
      .select("id, arabic_first_name, arabic_family_name")
      .in("id", ids.slice(i, i + 150));
    for (const d of docs ?? []) names.set(d.id, `${d.arabic_first_name} ${d.arabic_family_name}`);
  }
  const who = (id: string | null, fallback: string) => (id ? (names.get(id) ?? "حساب محذوف") : fallback);
  const institutionName = (id: string) => institutions?.find((i) => i.id === id)?.name_ar;

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-bold">سجل النشاط</h1>
      <p className="text-sm text-muted">آخر 200 حدث، الأحدث أولًا. الأوقات بتوقيت القدس.</p>
      {error && (
        <p role="alert" className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
          تعذّر تحميل السجل. حاول مجددًا.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-foreground/5 text-muted">
            <tr>
              <th className="p-3 text-start font-medium">الوقت</th>
              <th className="p-3 text-start font-medium">الحدث</th>
              <th className="p-3 text-start font-medium">بواسطة</th>
              <th className="p-3 text-start font-medium">الطبيب</th>
              <th className="p-3 text-start font-medium">التفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap p-3 tabular-nums text-muted" dir="ltr">
                  {auditTime(r.created_at)}
                </td>
                <td className="whitespace-nowrap p-3 font-semibold">{auditTitle(r.action)}</td>
                <td className="p-3">{who(r.actor_doctor_id, "النظام")}</td>
                <td className="p-3">{r.target_doctor_id ? who(r.target_doctor_id, "") : "-"}</td>
                <td className="p-3 text-muted">{auditDetail(r, institutionName)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  لا أحداث.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
