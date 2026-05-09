import Link from "next/link";
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
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-foreground/10 pb-3 text-sm">
        <Link
          href="/admin"
          className="rounded-md px-3 py-1.5 hover:bg-foreground/5"
        >
          الأطباء
        </Link>
        <Link
          href="/admin/specialties"
          className="rounded-md px-3 py-1.5 hover:bg-foreground/5"
        >
          التخصصات
        </Link>
        <Link
          href="/admin/audit"
          className="rounded-md px-3 py-1.5 hover:bg-foreground/5"
        >
          سجل النشاط
        </Link>
      </nav>
      {children}
    </div>
  );
}
