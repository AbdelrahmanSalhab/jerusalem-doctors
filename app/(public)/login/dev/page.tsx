// /login/dev — email + password sign-in for the people building and testing
// this app.
//
// notFound() rather than a redirect when the flag is off: with DEV_LOGIN
// unset this path is indistinguishable from any other address that was never
// a page. Nothing links here, and the whole site is noindex (app/layout.tsx).
//
// The unadvertised path is a convenience, not a control. See
// lib/auth/devLogin.ts for what the protection actually rests on.

import Link from "next/link";
import { notFound } from "next/navigation";
import { DevLoginForm } from "./DevLoginForm";
import { devLoginEnabled } from "@/lib/auth/devLogin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "دخول فريق العمل",
  robots: { index: false, follow: false },
};

export default function DevLoginPage() {
  if (!devLoginEnabled()) notFound();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-5 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">دخول فريق العمل</h1>
        <p className="text-sm text-muted">
          خاص بفريق التطوير وفحص الجودة. الأطباء يسجّلون دخولهم برقم الهاتف من{" "}
          <Link href="/login" className="underline">
            صفحة تسجيل الدخول
          </Link>
          .
        </p>
      </header>

      <DevLoginForm />

      <p className="text-xs text-muted">يُسجَّل كل دخول من هنا في سجل النشاط.</p>
    </main>
  );
}
