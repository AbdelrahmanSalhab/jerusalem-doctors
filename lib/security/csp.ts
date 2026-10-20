// The Content-Security-Policy, built per request around a fresh nonce
// (proxy.ts). Only scripts carrying the nonce run, plus what they load
// themselves ('strict-dynamic'): Next's runtime, the theme boot script,
// Turnstile and Vercel Analytics. An injected <script> or inline handler does
// not. Follows node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.

const TURNSTILE = "https://challenges.cloudflare.com";

export interface CspInput {
  nonce: string;
  /** NEXT_PUBLIC_SUPABASE_URL: doctor photos load from its storage. */
  supabaseUrl?: string;
  /** NEXT_PUBLIC_SENTRY_DSN: the browser reports errors to its host. */
  sentryDsn?: string;
  /** Off for http://localhost (the e2e stack); on everywhere served over https. */
  upgradeInsecure: boolean;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp({ nonce, supabaseUrl, sentryDsn, upgradeInsecure }: CspInput): string {
  const supabase = originOf(supabaseUrl);
  const sentry = originOf(sentryDsn);
  const directives: [string, ...(string | null)[]][] = [
    ["default-src", "'self'"],
    // The host is a fallback for browsers without 'strict-dynamic'.
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", TURNSTILE],
    // Inline style attributes are used in a few components; styles are not
    // a script-execution vector, scripts are what this policy is for.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", supabase],
    ["font-src", "'self'"],
    ["connect-src", "'self'", TURNSTILE, sentry],
    ["frame-src", TURNSTILE],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  if (upgradeInsecure) directives.push(["upgrade-insecure-requests"]);
  return directives.map((d) => d.filter(Boolean).join(" ")).join("; ");
}

/** A fresh, unguessable nonce for one response. */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
