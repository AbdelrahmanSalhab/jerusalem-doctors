"use client";

// Last-resort error boundary — fires when the root layout itself throws,
// so we render our own minimal <html>+<body>. Keeps the user oriented even
// when the site shell is broken.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
            خطأ في تحميل الموقع
          </h1>
          <p style={{ opacity: 0.7, marginBottom: "1rem" }}>
            حدث خطأ غير متوقّع. حاول إعادة تحميل الصفحة.
          </p>
          {error.digest && (
            <p style={{ fontSize: "0.75rem", opacity: 0.5, direction: "ltr" }}>
              {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "1rem",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.375rem",
              background: "currentColor",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
