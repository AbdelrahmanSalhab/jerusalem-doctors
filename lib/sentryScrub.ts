// What leaves for Sentry: values under known PII keys are replaced, and
// phone numbers are masked inside any string, including request URLs such as
// PostgREST filters (`phone_e164=eq.%2B972501234567`) in breadcrumbs.
//
// Sentry gets codes, counts and ids; names and contact details stay in our
// own activity log (raiseAlert's `logOnly`). This is the net under that rule.

import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { toAsciiDigits } from "@/lib/normalize/digits";

const PII_KEYS = new Set([
  "phone",
  "phone_e164",
  "phone_display",
  "license_number",
  "licenses",
  "secondary_license_number",
  "names",
  "arabic_first_name",
  "arabic_family_name",
  "arabic_full_name",
  "hebrew_first_name",
  "hebrew_family_name",
  "reporter_name",
  "reporter_contact",
  "contact",
  "otp",
  "otp_code",
  "sms",
  "token",
  "otp_token",
  "email",
  "ip",
  "authorization",
  "cookie",
  "set-cookie",
  "supabase_service_role_key",
  "supabase_anon_key",
  "turnstile_token",
  "cron_secret",
]);

// +972 / +970 (with +, %2B or bare) followed by 8-9 digits, or a local 05x
// number. Not when glued to a hex digit or hyphen, so ids such as
// "5f3c2972-..." are left intact; but right after a percent-escape it is a
// number again, as in PostgREST lists (`in.%28%2B972501234567%2C...`).
const PHONE =
  /(?:(?<=%[0-9A-Fa-f]{2})|(?<![\dA-Fa-f-]))(?:%2B|\+)?97[02][-\s]?\d{1,2}[-\s]?\d{3}[-\s]?\d{4}(?!\d)|(?:(?<=%[0-9A-Fa-f]{2})|\b)05\d[-\s]?\d{3}[-\s]?\d{4}\b/g;

/** Masks phone numbers, typed in Arabic-Indic digits too. */
export function scrubString(s: string): string {
  return toAsciiDigits(s).replace(PHONE, "[phone]");
}

/** Keys that are secret wherever they appear, including dotted span
 *  attribute names such as `http.request.header.cookie`. */
const SECRET_KEY = /cookie|authorization|token|secret|password/;

const isPiiKey = (key: string) => {
  const k = key.toLowerCase();
  return PII_KEYS.has(k) || SECRET_KEY.test(k);
};

export function scrubPii<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === "string") return scrubString(value) as T;
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]" as T;
  seen.add(value);
  // An Error's own message and stack are not enumerable: keep them, scrubbed.
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message), stack: scrubString(value.stack ?? "") } as T;
  }
  if (Array.isArray(value)) return value.map((v) => scrubPii(v, seen)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isPiiKey(k) ? "[Filtered]" : scrubPii(v, seen);
  }
  return out as T;
}

export const scrubEvent = (event: ErrorEvent): ErrorEvent => scrubPii(event);

/** A console.* call becomes a breadcrumb that keeps every logged value, such
 *  as a Postgres error whose details quote the failing row (a name, a
 *  licence). Only the message line is kept, which shows an error as its
 *  name and message. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const kept =
    crumb.category === "console" && crumb.data ? { ...crumb, data: { ...crumb.data, arguments: undefined } } : crumb;
  return scrubPii(kept);
}

/** Span fields that hold a URL or path: Next's own spans (http.target,
 *  http.url, a fetch span's name) keep the query string, which carries
 *  search terms, licences and phone lists. */
const URL_FIELDS = new Set(["http.target", "http.url", "url.full", "url.query", "http.query", "url"]);
const withoutQuery = (v: unknown) => (typeof v === "string" ? v.replace(/\?\S*/, "") : v);

/** Spans carry request URLs and query attributes too (beforeSend skips
 *  them). Fails closed: Sentry sends a span unchanged when this throws. */
export function scrubSpan<T extends { name?: string; attributes?: Record<string, unknown> }>(span: T): T {
  try {
    const attributes = span.attributes
      ? Object.fromEntries(Object.entries(span.attributes).map(([k, v]) => [k, URL_FIELDS.has(k) ? withoutQuery(v) : v]))
      : span.attributes;
    return scrubPii({ ...span, name: withoutQuery(span.name), attributes });
  } catch {
    // Keep the span's ids and timings so it still sends; nothing else.
    const safe: Record<string, unknown> = {};
    for (const key of Object.keys(span)) {
      if (key === "name" || key === "attributes") continue;
      try {
        const v = (span as Record<string, unknown>)[key];
        if (typeof v !== "object" || v === null) safe[key] = v;
      } catch {
        // An unreadable field is simply left out.
      }
    }
    return { ...safe, name: "[unscrubbable span]", attributes: {} } as unknown as T;
  }
}

/**
 * What the SDK may collect, for every Sentry.init (server, edge, browser).
 * Sentry 11 collects all of it when this is left out (v10 collected little
 * unless sendDefaultPii was on), so each category is closed explicitly:
 * no user info, cookies, IP-carrying headers, bodies, query data, local
 * variables or task arguments.
 */
export const PRIVATE_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  // Only headers known to be harmless. A deny list let the Referer (the
  // previous page's full URL and query) and IP headers nobody listed through.
  httpHeaders: { request: { allow: ["user-agent", "content-type", "accept"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
};
