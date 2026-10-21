// Alerts: what the app tells whoever runs it. Each goes to Sentry, as
// before, and to the activity log as an `alert` entry, so an admin who does
// not use Sentry sees it under التنبيهات in the admin panel.
//
// Every alert the app raises is listed here, with its Sentry message (kept
// as it was, so existing Sentry alert rules still match) and the Arabic an
// admin reads.

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";

type Level = "info" | "warning" | "error";

export const ALERTS = {
  doctor_waiting: { sentry: "New doctor waiting for approval", ar: "طبيب جديد بانتظار القبول", level: "info" },
  sms_half_budget: { sentry: "Half the daily SMS budget used", ar: "استُهلك نصف حد الرسائل اليومي", level: "warning" },
  sms_cap_reached: {
    sentry: "Daily SMS cap reached",
    ar: "بلغت الرسائل الحد اليومي: لا رموز تحقق حتى يتجدد",
    level: "error",
  },
  sms_balance_low: { sentry: "SMS4FREE balance low", ar: "رصيد الرسائل في SMS4FREE منخفض", level: "warning" },
  unknown_workplaces: {
    sentry: "Workplace names not in the institutions list",
    ar: "أماكن عمل غير موجودة في قائمة المستشفيات",
    level: "warning",
  },
  licenses_missing: {
    sentry: "Doctor licences no longer in the MoH registry",
    ar: "تراخيص أطباء لم تعد في سجل وزارة الصحة",
    level: "warning",
  },
  db_size_high: {
    sentry: "Database past 70% of the free plan",
    ar: "قاعدة البيانات تجاوزت ٧٠٪ من حد الخطة المجانية",
    level: "warning",
  },
  ratelimit_timeout: {
    sentry: "Rate limiter timed out (fail-open)",
    ar: "تأخر نظام حماية الطلبات، فسُمح بالطلبات دون فحص",
    level: "warning",
  },
} as const satisfies Record<string, { sentry: string; ar: string; level: Level }>;

export type AlertCode = keyof typeof ALERTS;

export function isAlertCode(v: unknown): v is AlertCode {
  return typeof v === "string" && v in ALERTS;
}

/** Sends one alert to Sentry and the activity log. Never throws: the
 *  action it reports has happened either way. */
export async function raiseAlert(
  service: SupabaseClient,
  code: AlertCode,
  details: { level?: Level; extra?: Record<string, unknown>; tags?: Record<string, string> } = {},
): Promise<void> {
  const { sentry, level: defaultLevel } = ALERTS[code];
  const level = details.level ?? defaultLevel;
  Sentry.captureMessage(sentry, { level, extra: details.extra, tags: details.tags });
  await writeAudit(service, { action: "alert", metadata: { alert: code, level, ...details.extra } });
}
