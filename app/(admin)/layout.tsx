import { NavTabs } from "@/components/NavTabs";
import { ALERT_NOUN, countOf } from "@/lib/arabicCount";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // requireAdmin() returns 404 for non-admins, so the panel's existence is
  // not leaked to regular users.
  await requireAdmin();
  const [alerts, requests, reports] = await Promise.all([recentAlerts(), openRequests(), openReports()]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 border-b border-line">
        <NavTabs
          label="أقسام الإدارة"
          tabs={[
            { href: "/admin", label: "الأطباء", exact: true },
            { href: "/admin/stats", label: "الإحصائيات" },
            { href: "/admin/institutions", label: "المستشفيات" },
            { href: "/admin/specialties", label: "التخصصات" },
            {
              href: "/admin/requests",
              label: "طلبات الأرقام",
              badge: requests,
              badgeLabel: `${requests} بانتظار الرد`,
            },
            {
              href: "/admin/reports",
              label: "البلاغات",
              badge: reports,
              badgeLabel: `${reports} بلاغ مفتوح`,
            },
            { href: "/admin/audit", label: "سجل النشاط" },
            {
              href: "/admin/audit?action=alert",
              label: "التنبيهات",
              badge: alerts,
              badgeLabel: `${countOf(alerts, ALERT_NOUN)} في آخر 24 ساعة`,
            },
          ]}
        />
      </div>
      {children}
    </div>
  );
}

/** Warnings and urgent alerts in the last 24 hours (lib/alerts.ts); "a new
 *  doctor is waiting" has its own count in the account menu. One indexed
 *  count per admin page. */
async function recentAlerts(): Promise<number> {
  const { count, error } = await createSupabaseServiceClient()
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "alert")
    .in("metadata->>level", ["warning", "error"])
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  // A badge is not worth failing the admin panel over.
  return error ? 0 : (count ?? 0);
}

/** Number requests no admin has answered yet (app/(admin)/admin/requests). */
async function openRequests(): Promise<number> {
  const { count, error } = await createSupabaseServiceClient()
    .from("number_requests")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);
  return error ? 0 : (count ?? 0);
}

/** Profile reports no admin has closed yet (app/(admin)/admin/reports). */
async function openReports(): Promise<number> {
  const { count, error } = await createSupabaseServiceClient()
    .from("profile_reports")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);
  return error ? 0 : (count ?? 0);
}
