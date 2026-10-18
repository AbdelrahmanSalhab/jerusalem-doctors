// What leaves for Sentry: values under known PII keys are replaced, and
// phone numbers are masked inside any string, including request URLs such as
// PostgREST filters (`phone_e164=eq.%2B972501234567`) in breadcrumbs.

import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

const PII_KEYS = new Set([
  "phone",
  "phone_e164",
  "phone_display",
  "license_number",
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

export function scrubPii<T>(value: T): T {
  if (typeof value === "string") return scrubString(value) as T;
  if (Array.isArray(value)) return value.map(scrubPii) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? "[Filtered]" : scrubPii(v);
    }
    return out as T;
  }
  return value;
}

export const scrubEvent = (event: ErrorEvent): ErrorEvent => scrubPii(event);
export const scrubBreadcrumb = (crumb: Breadcrumb): Breadcrumb => scrubPii(crumb);
/** Traces carry request URLs and query attributes too (beforeSend skips them). */
export const scrubTransaction = <T extends object>(event: T): T => scrubPii(event);
