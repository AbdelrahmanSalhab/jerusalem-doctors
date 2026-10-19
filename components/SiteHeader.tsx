import Image from "next/image";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getCurrentDoctor } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/** Active doctors waiting for approval; shown to admins on the nav link. */
async function countPending(): Promise<number> {
  const { count, error } = await createSupabaseServiceClient()
    .from("doctors")
    .select("id", { count: "exact", head: true })
    .eq("is_admin_approved", false)
    .eq("is_active", true);
  return error ? 0 : (count ?? 0);
}

export const ORG_NAME_AR = "تجمّع أطباء العائلة المقدسي";

/**
 * Site-wide header with logo, organization name, and auth controls.
 * Server component, branches on whether the visitor has a session.
 */
export async function SiteHeader() {
  // A deactivated doctor can still hold a session, but every page sends
  // them to /login; showing logged-in links there is a dead end.
  const current = await getCurrentDoctor().catch(() => null);
  const doctor = current?.is_active ? current : null;
  const pending = doctor?.is_admin ? await countPending().catch(() => 0) : 0;

  return (
    <header className="border-b border-foreground/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 hover:opacity-90 sm:gap-3"
        >
          {/* The logo is a JPEG on white, so it sits on a deliberate white
              badge rather than as a white square on the dark theme. */}
          <span className="rounded-lg bg-white p-1 shadow-sm ring-1 ring-line">
            <Image
              src="/logo.jpeg"
              alt={ORG_NAME_AR}
              width={64}
              height={64}
              priority
              className="h-10 w-10 object-contain sm:h-14 sm:w-14 md:h-16 md:w-16"
            />
          </span>
          {/* Logo image already includes the org name; on mobile we drop the
              redundant text label to keep the header on one line. */}
          <span className="hidden text-lg font-semibold leading-tight sm:inline md:text-xl">
            {ORG_NAME_AR}
          </span>
        </Link>

        <nav className="flex shrink-0 items-center gap-1.5 text-sm sm:gap-2 md:text-base">
          {doctor ? (
            <>
              <Link
                href="/dashboard"
                className="rounded-md px-2.5 py-1.5 hover:bg-foreground/5 sm:px-3"
              >
                لوحة البحث
              </Link>
              <Link
                href="/profile"
                className="rounded-md px-2.5 py-1.5 hover:bg-foreground/5 sm:px-3"
              >
                ملفي
              </Link>
              {doctor.is_admin && (
                <Link
                  href="/admin"
                  className="rounded-md px-2.5 py-1.5 hover:bg-foreground/5 sm:px-3"
                >
                  الإدارة
                  {pending > 0 && (
                    <span
                      className="ms-1.5 rounded-full bg-warn-solid px-1.5 text-xs font-semibold text-white"
                      aria-label={`${pending} بانتظار المراجعة`}
                    >
                      {pending}
                    </span>
                  )}
                </Link>
              )}
              <LogoutButton className="rounded-md border border-foreground/20 px-2.5 py-1.5 hover:bg-foreground/5 sm:px-3" />
            </>
          ) : current ? (
            // Deactivated but still signed in: the only useful control.
            <LogoutButton className="rounded-md border border-foreground/20 px-2.5 py-1.5 hover:bg-foreground/5 sm:px-3" />
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md border border-foreground/20 px-2.5 py-1.5 hover:bg-foreground/5 sm:px-3"
              >
                تسجيل الدخول
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-primary px-2.5 py-1.5 text-primary-fg hover:opacity-90 sm:px-3"
              >
                إنشاء حساب
              </Link>
            </>
          )}
          <ThemeToggle className="rounded-md px-2 py-1.5 text-foreground/80 hover:bg-foreground/5" />
        </nav>
      </div>
    </header>
  );
}
