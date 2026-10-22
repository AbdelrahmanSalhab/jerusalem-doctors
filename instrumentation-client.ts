// Client-side Sentry init. Runs in the browser.
import * as Sentry from "@sentry/nextjs";
import { PRIVATE_DATA_COLLECTION, scrubBreadcrumb, scrubEvent, scrubSpan } from "@/lib/sentryScrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
    // The same scrubbing as the server: browser errors carry page URLs
    // (/admin?q=0521234567) and breadcrumbs too (lib/sentryScrub.ts).
    dataCollection: PRIVATE_DATA_COLLECTION,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendSpan: scrubSpan,
    // Pinned: SENTRY_TRACE_LIFECYCLE=static would make Sentry skip a plain
    // beforeSendSpan and send spans unscrubbed.
    traceLifecycle: "stream",
    // No session replay, keeps bundle smaller and avoids capturing screen
    // content of doctor profiles.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}
