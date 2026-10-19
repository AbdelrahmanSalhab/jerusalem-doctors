import Image from "next/image";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { AccountMenu } from "@/components/AccountMenu";
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

/** What the site calls itself everywhere: header, logo alt, page titles. */
export const SITE_NAME_AR = "دليل أطباء القدس";

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

  const button = "rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-foreground/5 sm:px-3";
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2 hover:opacity-90 sm:gap-3">
          {/* The logo is a JPEG on white, so it sits on a deliberate white
              badge rather than as a white square on the dark theme. */}
          <span className="shrink-0 rounded-lg bg-white p-1 shadow-sm ring-1 ring-line">
            <Image
              src="/logo.jpeg"
              alt={SITE_NAME_AR}
              width={64}
              height={64}
              priority
              className="h-9 w-9 object-contain sm:h-12 sm:w-12"
            />
          </span>
          <span className="truncate text-base font-semibold leading-tight sm:text-lg">
            {SITE_NAME_AR}
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ThemeToggle className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-foreground/5 hover:text-foreground" />
          {doctor ? (
            <AccountMenu
              photoUrl={doctor.profile_picture_url}
              firstName={doctor.arabic_first_name}
              isAdmin={doctor.is_admin}
              pending={pending}
            />
          ) : current ? (
            // A deactivated doctor still holding a session: every page sends
            // them to /login, so logging out is all the header can offer.
            <LogoutButton className={button} />
          ) : (
            <>
              <Link href="/login" className={button}>
                تسجيل الدخول
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-primary px-2.5 py-1.5 text-sm text-primary-fg hover:opacity-90 sm:px-3"
              >
                إنشاء حساب
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
