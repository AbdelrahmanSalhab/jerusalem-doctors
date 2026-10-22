// Sentry edge-runtime init (middleware/proxy.ts runs here).
import * as Sentry from "@sentry/nextjs";
import { PRIVATE_DATA_COLLECTION, scrubBreadcrumb, scrubEvent, scrubSpan } from "@/lib/sentryScrub";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    dataCollection: PRIVATE_DATA_COLLECTION,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendSpan: scrubSpan,
    // Pinned: SENTRY_TRACE_LIFECYCLE=static would make Sentry skip a plain
    // beforeSendSpan and send spans unscrubbed.
    traceLifecycle: "stream",
  });
}
