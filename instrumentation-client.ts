// Runs in the browser before the app's own code: Sentry, and Zod's setting.
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { browserBreadcrumb, PRIVATE_DATA_COLLECTION, scrubEvent, scrubSpan } from "@/lib/sentryScrub";

// Zod 4 probes whether it may compile validators with Function(""). The
// Content-Security-Policy refuses that by design (lib/security/csp.ts), and
// the refusal is reported as a violation even though Zod falls back
// quietly: Lighthouse marked /signup down for it (#168). jitless skips the
// probe; the plain validators are what ran anyway.
z.config({ jitless: true });

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    // Errors only: no performance tracing, so no request or render data
    // leaves as spans. The span scrubbing below stays as a safety net.
    tracesSampleRate: 0,
    // The same scrubbing as the server: browser errors carry page URLs
    // (/admin?q=0521234567) and breadcrumbs too (lib/sentryScrub.ts).
    dataCollection: PRIVATE_DATA_COLLECTION,
    beforeSend: scrubEvent,
    beforeBreadcrumb: browserBreadcrumb,
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
