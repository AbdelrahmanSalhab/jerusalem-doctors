// The local stack the integration and browser tests run against: Supabase
// from `supabase start` (supabase/config.toml), Redis REST from
// e2e/docker-compose.yml, and the built app on PORT.
//
// The keys are the Supabase CLI's fixed local demo keys, the same on every
// machine. They open nothing outside a local stack.

export const PORT = 3123;
export const BASE_URL = `http://localhost:${PORT}`;

export const SUPABASE_URL = "http://127.0.0.1:54321";
export const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export const REDIS_REST_URL = "http://127.0.0.1:8079";
export const REDIS_REST_TOKEN = "e2e-token";

export const CRON_SECRET = "e2e-cron-secret";

/** Cloudflare's published always-pass Turnstile test keys. */
export const TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";

/** e2e/stubs.mjs: data.gov.il's registry and SMS4FREE's send API. */
export const STUB_PORT = 3124;
export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

export const PASSWORD = "e2e-password-123";

/** Accounts that can sign in through /login/dev. */
export const ACCOUNTS = {
  admin: "admin@e2e.test",
  doctor: "doctor@e2e.test",
  pending: "pending@e2e.test",
  closed: "closed@e2e.test",
} as const;
export type Role = keyof typeof ACCOUNTS;

/** The account /api/login/ci signs in (scripts/add-ci-account.ts in production). */
export const CI_LOGIN_EMAIL = "ci@e2e.invalid";

/** Accounts a single test creates and removes (e.g. the deletion request). */
export const THROWAWAY_ACCOUNTS = ["leaving@e2e.test"];

/** Sentry's ingest, served by e2e/stubs.mjs. */
export const SENTRY_STUB_DSN = `${STUB_URL.replace("://", "://e2e@")}/1`;

/** Everything the app reads from its environment, for both build and start. */
export function appEnv(): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    UPSTASH_REDIS_REST_URL: REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: REDIS_REST_TOKEN,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY,
    DEV_LOGIN: "1",
    DEV_LOGIN_EMAILS: [...Object.values(ACCOUNTS), ...THROWAWAY_ACCOUNTS].join(","),
    // The smoke check's sign-in (app/api/login/ci), with the stub playing GitHub.
    CI_LOGIN_EMAIL,
    GITHUB_OIDC_JWKS_URL: `${STUB_URL}/github-oidc/jwks`,
    // The production provider, pointed at the stub: the mock sender refuses
    // to run in a production build, and this is the path real codes take.
    OTP_PROVIDER: "sms4free",
    SMS4FREE_API_URL: `${STUB_URL}/sms4free/send`,
    SMS4FREE_KEY: "e2e-key",
    SMS4FREE_USER: "0500000000",
    SMS4FREE_PASS: "e2e-pass",
    SMS4FREE_SENDER: "JDoctors",
    SEND_SMS_HOOK_SECRET: "v1,whsec_ZTJlLXRlc3QtaG9vay1zZWNyZXQtZm9yLWNp",
    CRON_SECRET,
    // Tests change doctors straight in the database (lib/cachedReads.ts).
    DIRECTORY_CACHE_SECONDS: "0",
    MOH_API_BASE: `${STUB_URL}/api/3`,
    // Sentry on, sending to the stub, so a test can read what would leave
    // (e2e/ui/sentry-privacy.spec.ts).
    SENTRY_DSN: SENTRY_STUB_DSN,
    NEXT_PUBLIC_SENTRY_DSN: SENTRY_STUB_DSN,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
