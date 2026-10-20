import { requireAdmin } from "@/lib/auth/session";
import Link from "next/link";
import { redirect } from "next/navigation";
import { countOf, EVENTS } from "@/lib/arabicCount";
import { auditDetail, auditFields, auditTime, auditTimeFull, auditTitle } from "@/lib/auditText";
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

const PAGE_SIZE = 50;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  // The (admin) layout's check alone is not enough: Next can render this
  // page without re-running the layout. requireAdmin is request-cached.
  await requireAdmin();
  const page = Math.max(1, Math.floor(Number((await searchParams).page)) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const service = createSupabaseServiceClient();
  const [{ data, error, count }, { data: institutions }] = await Promise.all([
    service
      .from("audit_logs")
      .select("id, action, actor_doctor_id, target_doctor_id, metadata, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      // Same time? The id keeps the order stable from one page to the next.
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    service.from("institutions").select("id, name_ar"),
  ]);
  // PostgREST answers a page past the end with PGRST103.
  if (error?.code === "PGRST103") redirect("/admin/audit");
  const rows = (data ?? []) as Row[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
      <p className="text-sm text-muted">
        {countOf(total, EVENTS)} في السجل، الأحدث أولًا. الأوقات بتوقيت القدس.
      </p>
      {error && (
        <p role="alert" className="rounded border border-danger-line bg-danger-bg p-3 text-sm text-danger">
          تعذّر تحميل السجل. حاول مجددًا.
        </p>
      )}

      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        <li
          aria-hidden="true"
          className="hidden gap-3 bg-foreground/5 px-4 py-2.5 text-sm text-muted md:grid md:grid-cols-[8.5rem_10rem_1fr_1fr_2fr]"
        >
          <span>الوقت</span>
          <span>الحدث</span>
          <span>بواسطة</span>
          <span>الطبيب</span>
          <span>التفاصيل</span>
        </li>
        {rows.map((r) => {
          const doctor = r.target_doctor_id ? who(r.target_doctor_id, "") : "";
          const fields = auditFields(r, institutionName);
          return (
            <li key={r.id}>
              {/* Click a row to see everything the entry kept. */}
              <details className="group">
                <summary className="grid cursor-pointer list-none grid-cols-1 gap-1 px-4 py-3 text-sm hover:bg-foreground/5 md:grid-cols-[8.5rem_10rem_1fr_1fr_2fr] md:gap-3 [&::-webkit-details-marker]:hidden">
                  <span className="tabular-nums text-muted" dir="ltr">
                    <span aria-hidden="true" className="me-1 inline-block transition-transform group-open:rotate-90">
                      ›
                    </span>
                    {auditTime(r.created_at)}
                  </span>
                  <span className="font-semibold">{auditTitle(r.action)}</span>
                  <span>
                    <span className="text-muted md:hidden">بواسطة: </span>
                    {who(r.actor_doctor_id, "النظام")}
                  </span>
                  <span>
                    <span className="text-muted md:hidden">الطبيب: </span>
                    {doctor || "-"}
                  </span>
                  <span className="text-muted">{auditDetail(r, institutionName)}</span>
                </summary>

                <div className="flex flex-col gap-3 border-t border-line bg-background/60 px-4 py-4 text-sm">
                  <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5">
                    <dt className="text-muted">الوقت الدقيق</dt>
                    <dd className="tabular-nums" dir="ltr">
                      {auditTimeFull(r.created_at)}
                    </dd>
                    <dt className="text-muted">الحدث</dt>
                    <dd>{auditTitle(r.action)}</dd>
                    {fields.map((f) => (
                      <div key={f.label} className="contents">
                        <dt className="text-muted">{f.label}</dt>
                        <dd dir={f.ltr ? "ltr" : undefined} className={f.ltr ? "break-all font-mono text-xs" : ""}>
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {doctor && doctor !== "حساب محذوف" && (
                    <Link
                      href={`/admin?doctor=${r.target_doctor_id}`}
                      className="self-start rounded-md border border-line px-3 py-1.5 hover:bg-foreground/5"
                    >
                      فتح الطبيب في قائمة الأطباء
                    </Link>
                  )}

                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">للمطوّرين</summary>
                    <dl className="mt-2 grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1" dir="ltr">
                      <dt>action</dt>
                      <dd className="font-mono">{r.action}</dd>
                      <dt>entry</dt>
                      <dd className="break-all font-mono">{r.id}</dd>
                      <dt>actor</dt>
                      <dd className="break-all font-mono">{r.actor_doctor_id ?? "-"}</dd>
                      <dt>target</dt>
                      <dd className="break-all font-mono">{r.target_doctor_id ?? "-"}</dd>
                    </dl>
                  </details>
                </div>
              </details>
            </li>
          );
        })}
        {rows.length === 0 && <li className="p-6 text-center text-muted">لا أحداث.</li>}
      </ul>

      {pages > 1 && (
        <nav aria-label="صفحات السجل" className="flex items-center justify-between gap-3 text-sm">
          {page > 1 ? (
            <Link href={`/admin/audit?page=${page - 1}`} className="rounded border border-line px-3 py-1.5 hover:bg-foreground/5">
              السابق
            </Link>
          ) : (
            <span />
          )}
          <span className="tabular-nums text-muted">
            الصفحة {page} من {pages}
          </span>
          {page < pages ? (
            <Link href={`/admin/audit?page=${page + 1}`} className="rounded border border-line px-3 py-1.5 hover:bg-foreground/5">
              التالي
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
