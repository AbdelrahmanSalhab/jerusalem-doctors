// /login/dev — email + password sign-in for the people building and testing
// this app.
//
// notFound() rather than a redirect when the flag is off: with DEV_LOGIN
// unset this path is indistinguishable from any other address that was never
// a page. Nothing links here, and the whole site is noindex (app/layout.tsx).
//
// The unadvertised path is a convenience, not a control. See
// lib/auth/devLogin.ts for what the protection actually rests on.

import { notFound } from "next/navigation";
import { DevLoginForm } from "./DevLoginForm";
import { devLoginEnabled } from "@/lib/auth/devLogin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Staff sign-in",
  robots: { index: false, follow: false },
};

export default function DevLoginPage() {
  if (!devLoginEnabled()) notFound();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-5 px-4 py-12">
      <header className="flex flex-col gap-1" dir="ltr">
        <h1 className="text-xl font-bold">Staff sign-in</h1>
        <p className="text-sm text-muted">
          For the development and QA team. Doctors sign in with their phone number on{" "}
          <a href="/login" className="underline">
            /login
          </a>
          .
        </p>
      </header>

      <DevLoginForm />

      <p className="text-xs text-muted" dir="ltr">
        Every sign-in here is recorded in the activity log.
      </p>
    </main>
  );
}
