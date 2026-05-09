"use client";

// Per-route error boundary — caught by Next when a server component or
// route handler throws. Stays inside the site shell (header + footer).

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <main className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-20 text-center">
      <h1 className="text-3xl font-bold">حدث خطأ</h1>
      <p className="text-foreground/70">
        حدث خطأ غير متوقّع. يمكنك المحاولة مرّة أخرى أو العودة إلى الصفحة
        الرئيسية.
      </p>
      {error.digest && (
        <p className="text-xs text-foreground/50" dir="ltr">
          رقم الخطأ: {error.digest}
        </p>
      )}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-foreground px-5 py-2.5 text-background hover:opacity-90"
        >
          إعادة المحاولة
        </button>
        <a
          href="/"
          className="rounded-md border border-foreground/20 px-5 py-2.5 hover:bg-foreground/5"
        >
          الرئيسية
        </a>
      </div>
    </main>
  );
}
