// Sentry server-side init. Loaded by instrumentation.ts.
//
// No-ops cleanly when SENTRY_DSN is unset — dev local doesn't need a DSN.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1, // light tracing; ample for MVP traffic
    // Drop PII from event payloads before they leave the server.
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubPiiFromEvent(event);
    },
  });
}

// Keys whose values should never appear in Sentry payloads.
const PII_KEYS = new Set([
  "phone",
  "phone_e164",
  "phone_display",
  "license_number",
  "otp_code",
  "token",
  "otp_token",
  "email",
  "authorization",
  "cookie",
  "set-cookie",
  "supabase_service_role_key",
  "supabase_anon_key",
  "turnstile_token",
  "cron_secret",
]);

function scrubPiiFromEvent<T extends object>(obj: T): T {
  // Shallow recursive scrub. Replaces values for known PII keys with "[Filtered]".
  if (Array.isArray(obj)) {
    return obj.map((v) =>
      v && typeof v === "object" ? scrubPiiFromEvent(v) : v,
    ) as unknown as T;
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (PII_KEYS.has(k.toLowerCase())) {
        out[k] = "[Filtered]";
      } else if (v && typeof v === "object") {
        out[k] = scrubPiiFromEvent(v as Record<string, unknown>);
      } else {
        out[k] = v;
      }
    }
    return out as T;
  }
  return obj;
}
