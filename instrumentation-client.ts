// Client-side Sentry init. Runs in the browser.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    // No session replay — keeps bundle smaller and avoids capturing screen
    // content of doctor profiles.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}
