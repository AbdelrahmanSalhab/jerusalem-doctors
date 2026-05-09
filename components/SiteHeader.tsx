import Image from "next/image";
import Link from "next/link";
import { getCurrentDoctor } from "@/lib/auth/session";

export const ORG_NAME_AR = "تجمّع أطباء العائلة المقدسي";

/**
 * Site-wide header with logo, organization name, and auth controls.
 * Server component — branches on whether the visitor has a session.
 */
export async function SiteHeader() {
  const doctor = await getCurrentDoctor().catch(() => null);

  return (
    <header className="border-b border-foreground/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 hover:opacity-90 sm:gap-3"
        >
          <Image
            src="/logo.jpeg"
            alt={ORG_NAME_AR}
            width={64}
            height={64}
            priority
            className="h-12 w-12 rounded-md object-contain sm:h-16 sm:w-16 md:h-20 md:w-20"
          />
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
                </Link>
              )}
              <form action="/api/auth/logout" method="post">
                <button className="rounded-md border border-foreground/20 px-2.5 py-1.5 hover:bg-foreground/5 sm:px-3">
                  تسجيل الخروج
                </button>
              </form>
            </>
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
                className="rounded-md bg-foreground px-2.5 py-1.5 text-background hover:opacity-90 sm:px-3"
              >
                إنشاء حساب
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
