import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const service = createSupabaseServiceClient();
  const { data: rows, error } = await service
    .from("audit_logs")
    .select(
      "id, action, actor_doctor_id, target_doctor_id, metadata, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-bold">سجل النشاط</h1>
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error.message}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-foreground/15">
        <table className="w-full text-base">
          <thead className="bg-foreground/5">
            <tr>
              <th className="p-3 text-center">الوقت</th>
              <th className="p-3 text-center">الإجراء</th>
              <th className="p-3 text-center">المنفّذ</th>
              <th className="p-3 text-center">الهدف</th>
              <th className="p-3 text-center">تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-t border-foreground/10">
                <td className="p-3 text-center text-sm" dir="ltr">
                  {new Date(r.created_at)
                    .toISOString()
                    .slice(0, 19)
                    .replace("T", " ")}
                </td>
                <td className="p-3 text-center font-medium">{r.action}</td>
                <td className="p-3 text-center font-mono text-sm" dir="ltr">
                  {r.actor_doctor_id?.slice(0, 8) ?? "—"}
                </td>
                <td className="p-3 text-center font-mono text-sm" dir="ltr">
                  {r.target_doctor_id?.slice(0, 8) ?? "—"}
                </td>
                <td className="p-3 max-w-md break-words text-center font-mono text-sm">
                  {r.metadata ? JSON.stringify(r.metadata) : ""}
                </td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-foreground/65">
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
