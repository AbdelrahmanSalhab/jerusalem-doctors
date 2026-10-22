import { RequestsList } from "./RequestsList";
import { auditTime } from "@/lib/auditText";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Doctors asking for a colleague their search couldn't find, oldest first. */
export default async function AdminRequestsPage() {
  // The (admin) layout's check alone is not enough: Next can render this
  // page without re-running the layout. requireAdmin is request-cached.
  await requireAdmin();
  const { data, error } = await createSupabaseServiceClient()
    .from("number_requests")
    .select("id, query, created_at, requester:doctors!requester_id(arabic_full_name, phone_e164)")
    .is("resolved_at", null)
    .order("created_at");

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-bold">طلبات الأرقام</h1>
      <p className="text-sm text-muted">
        أطباء بحثوا عن زميل ولم يجدوه. أرسل الرقم للطالب عبر واتساب ثم اضغط «تم».
      </p>
      {error && (
        <p className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
          {error.message}
        </p>
      )}
      <RequestsList
        rows={(data ?? []).map((r) => ({
          id: r.id,
          query: r.query,
          asked_at: auditTime(r.created_at),
          // A to-one embed, typed as a list by the untyped client.
          requester: (Array.isArray(r.requester) ? r.requester[0] : r.requester) ?? null,
        }))}
      />
    </main>
  );
}
