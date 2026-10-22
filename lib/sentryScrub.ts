// What leaves for Sentry: values under known PII keys are replaced, and
// phone numbers are masked inside any string, including request URLs such as
// PostgREST filters (`phone_e164=eq.%2B972501234567`) in breadcrumbs.
//
// Sentry gets codes, counts and ids; names and contact details stay in our
// own activity log (raiseAlert's `logOnly`). This is the net under that rule.

import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

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
// "5f3c2972-..." are left intact.
const PHONE =
  /(?<![\dA-Fa-f-])(?:%2B|\+)?97[02][-\s]?\d{1,2}[-\s]?\d{3}[-\s]?\d{4}(?!\d)|\b05\d[-\s]?\d{3}[-\s]?\d{4}\b/g;

export function scrubString(s: string): string {
  return s.replace(PHONE, "[phone]");
}

/** Keys that are secret wherever they appear, including dotted span
 *  attribute names such as `http.request.header.cookie`. */
const SECRET_KEY = /cookie|authorization|token|secret|password/;

const isPiiKey = (key: string) => {
  const k = key.toLowerCase();
  return PII_KEYS.has(k) || SECRET_KEY.test(k);
};

export function scrubPii<T>(value: T): T {
  if (typeof value === "string") return scrubString(value) as T;
  if (Array.isArray(value)) return value.map(scrubPii) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isPiiKey(k) ? "[Filtered]" : scrubPii(v);
    }
    return out as T;
  }
  return value;
}

export const scrubEvent = (event: ErrorEvent): ErrorEvent => scrubPii(event);
export const scrubBreadcrumb = (crumb: Breadcrumb): Breadcrumb => scrubPii(crumb);
/** Spans carry request URLs and query attributes too (beforeSend skips them). */
export const scrubSpan = <T extends object>(span: T): T => scrubPii(span);

/**
 * What the SDK may collect, for every Sentry.init (server, edge, browser).
 * Sentry 11 collects all of it when this is left out (v10 collected little
 * unless sendDefaultPii was on), so each category is closed explicitly:
 * no user info, cookies, IP-carrying headers, bodies, query data, local
 * variables or task arguments.
 */
const IP_HEADERS = ["forwarded", "-ip", "remote-", "via", "-user", "cookie", "authorization"];
export const PRIVATE_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { deny: IP_HEADERS }, response: { deny: IP_HEADERS } },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
};
