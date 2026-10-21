// The free-plan limits the app is measured against (metrics_daily,
// /admin/stats). Change these when a plan changes.

/** Supabase free plan: database size. */
export const DB_LIMIT_BYTES = 500 * 1024 * 1024;

/** The daily SMS cap the app itself enforces (lib/ratelimit.ts smsDaily). */
export const SMS_DAILY_CAP = Number(process.env.SMS_DAILY_CAP) || 200;
