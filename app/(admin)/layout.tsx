import { NavTabs } from "@/components/NavTabs";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // requireAdmin() returns 404 for non-admins, so the panel's existence is
  // not leaked to regular users.
  await requireAdmin();

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
            { href: "/admin/audit", label: "سجل النشاط" },
          ]}
        />
      </div>
      {children}
    </div>
  );
}
