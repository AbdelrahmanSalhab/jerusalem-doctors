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
  "license",
  // A Postgres error's details and hint quote the row or key it failed on.
  "details",
  "hint",
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

// Israeli and Palestinian numbers: +972 / +970 (with +, 00, %2B or bare),
// local mobiles (05x) and landlines (02, 03, 04, 08, 09), with -, space, .
// or (..) between the groups. Not when glued to a hex digit, letter or
// hyphen, so ids such as "5f3c2972-..." are left intact; but right after a
// percent-escape it is a number again, as in PostgREST lists
// (`in.%28%2B972501234567%2C...`).
const AFTER_ESCAPE = String.raw`(?<=%[0-9A-Fa-f]{2})`;
// Between groups: -, space, dot, a + or %20 from a URL, or nothing.
const SEP = String.raw`(?:[-\s.+]|%20)?`;
// The last seven digits as 3+4 or 3+2+2.
const TAIL = String.raw`\d{3}${SEP}(?:\d{4}|\d{2}${SEP}\d{2})`;
const PHONE = new RegExp(
  [
    // +972 52..., 00972 (0)52..., %2B972 2 ...
    String.raw`(?:${AFTER_ESCAPE}|(?<![\dA-Fa-f-]))(?:%2B|\+|00)?97[02]${SEP}(?:\(0\)${SEP})?\(?\d{1,2}\)?${SEP}${TAIL}(?!\d)`,
    // Mobiles 05x, 07x numbers, landlines 02/03/04/08/09.
    String.raw`(?:${AFTER_ESCAPE}|(?<![\dA-Za-z.-]))\(?0(?:5\d|7\d|[2-489])\)?${SEP}${TAIL}(?!\d)`,
  ].join("|"),
  "g",
);

// Sentry describes a clicked or measured element by a CSS selector that
// includes these attributes, and the app puts doctors' names in them (a
// photo's alt). The attribute stays, its value goes. Sentry does not escape
// quotes in the value (a Hebrew ד"ר, a quoted nickname), so the value runs to
// the `"]` that ends the selector part: another attribute, a class or id, the
// next element (` > `), or the end.
const SELECTOR_ATTR = /\[(alt|title|aria-label|name|placeholder|value)="[\s\S]*?"\](?=\[|\.|#|\s>\s|\]|\s|$)/g;

// Postgres quotes the input it rejects ("invalid input syntax for type uuid:
// "..."", "invalid input value for enum ...: "...""), and the app wraps those
// messages in its own errors.
const PG_QUOTED_INPUT = /(invalid input (?:syntax|value) for [^:]*: )"[^"]*"/g;

/** Masks phone numbers (typed in Arabic-Indic digits too), names in element
 *  selectors, and the input Postgres quotes back. */
export function scrubString(s: string): string {
  return toAsciiDigits(s)
    .replace(SELECTOR_ATTR, "[$1]")
    .replace(PG_QUOTED_INPUT, '$1"[value]"')
    .replace(PHONE, "[phone]");
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

/** Sentry sends a thrown or captured non-Error (supabase-js returns its
 *  errors as plain objects) whole, as extra.__serialized__: only its code
 *  goes, since its message and details can quote the row. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const serialized = event.extra?.__serialized__;
  if (!serialized || typeof serialized !== "object") return scrubPii(event);
  // The object's message also becomes the exception's text: replace it too.
  const code = (serialized as { code?: unknown }).code ?? null;
  const values = event.exception?.values?.map((v) =>
    v.mechanism?.synthetic ? { ...v, value: `captured object (code ${code ?? "none"})` } : v,
  );
  return scrubPii({
    ...event,
    extra: { ...event.extra, __serialized__: { code } },
    ...(values ? { exception: { ...event.exception, values } } : {}),
  });
}

/** A console.* call becomes a breadcrumb that keeps every logged value, such
 *  as a Postgres error whose details quote the failing row (a name, a
 *  licence). Only the message line is kept, which shows an error as its
 *  name and message. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const kept =
    crumb.category === "console" && crumb.data ? { ...crumb, data: { ...crumb.data, arguments: undefined } } : crumb;
  return scrubPii(kept);
}

/** The browser keeps no click or console breadcrumbs at all: they describe
 *  what a doctor did and saw (an element named by a colleague's name), and
 *  Sentry is here for errors. The rest is scrubbed as on the server. */
export function browserBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category?.startsWith("ui.") || crumb.category === "console") return null;
  return scrubBreadcrumb(crumb);
}

/** Span fields that hold a URL or path: Next's own spans (http.target,
 *  http.url, a fetch span's name) keep the query string, which carries
 *  search terms, licences and phone lists. */
const URL_FIELDS = new Set(["http.target", "http.url", "url.full", "url", "sentry.segment.name"]);
/** Fields that are nothing but a query string: dropped whole. */
const QUERY_FIELDS = new Set(["url.query", "http.query"]);
const withoutQuery = (v: unknown) => (typeof v === "string" ? v.replace(/\?\S*/, "") : v);

/** Spans carry request URLs and query attributes too (beforeSend skips
 *  them). Fails closed: Sentry sends a span unchanged when this throws. */
export function scrubSpan<T extends { name?: string; attributes?: Record<string, unknown> }>(span: T): T {
  try {
    const attributes = span.attributes
      ? Object.fromEntries(
          Object.entries(span.attributes)
            .filter(([k]) => !QUERY_FIELDS.has(k))
            .map(([k, v]) => [k, URL_FIELDS.has(k) ? withoutQuery(v) : v]),
        )
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
