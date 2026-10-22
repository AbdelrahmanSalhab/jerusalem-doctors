// Sentry server-side init. Loaded by instrumentation.ts.
//
// No-ops cleanly when SENTRY_DSN is unset, dev local doesn't need a DSN.

import * as Sentry from "@sentry/nextjs";
import { PRIVATE_DATA_COLLECTION, scrubBreadcrumb, scrubEvent, scrubSpan } from "@/lib/sentryScrub";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // Errors only: no performance tracing, so no request or render data
    // leaves as spans. The span scrubbing below stays as a safety net.
    tracesSampleRate: 0,
    // Drop PII from event payloads before they leave the server
    // (lib/sentryScrub.ts).
    dataCollection: PRIVATE_DATA_COLLECTION,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendSpan: scrubSpan,
    // Pinned: SENTRY_TRACE_LIFECYCLE=static would make Sentry skip a plain
    // beforeSendSpan and send spans unscrubbed.
    traceLifecycle: "stream",
  });
}
