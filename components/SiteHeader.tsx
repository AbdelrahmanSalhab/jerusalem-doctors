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
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-3 hover:opacity-90"
        >
          <Image
            src="/logo.jpeg"
            alt={ORG_NAME_AR}
            width={64}
            height={64}
            priority
            className="h-16 w-16 rounded-md object-contain"
          />
          <span className="text-lg font-semibold leading-tight">
            {ORG_NAME_AR}
          </span>
        </Link>

        <nav className="flex items-center gap-2 text-sm">
          {doctor ? (
            <>
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-1.5 hover:bg-foreground/5"
              >
                لوحة البحث
              </Link>
              <form action="/api/auth/logout" method="post">
                <button className="rounded-md border border-foreground/20 px-3 py-1.5 hover:bg-foreground/5">
                  تسجيل الخروج
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md border border-foreground/20 px-3 py-1.5 hover:bg-foreground/5"
              >
                تسجيل الدخول
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-foreground px-3 py-1.5 text-background hover:opacity-90"
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
