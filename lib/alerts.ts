// Alerts: what the app tells whoever runs it. Each goes to Sentry, as
// before, and to the activity log as an `alert` entry, so an admin who does
// not use Sentry sees it under التنبيهات in the admin panel.
//
// Every alert the app raises is listed here, with its Sentry message (kept
// as it was, so existing Sentry alert rules still match), the Arabic an
// admin reads, and what the admin should do about it.

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";

type Level = "info" | "warning" | "error";

export const ALERTS = {
  doctor_waiting: {
    sentry: "New doctor waiting for approval",
    ar: "طبيب جديد بانتظار القبول",
    level: "info",
    todo: "افتح «بانتظار الموافقة» في لوحة الإدارة، راجع الترخيص والبيانات، ثم اقبل أو ارفض.",
  },
  sms_half_budget: {
    sentry: "Half the daily SMS budget used",
    ar: "استُهلك نصف حد الرسائل اليومي",
    level: "warning",
    todo: "لا شيء الآن. إن تكرر في أيام عادية فراجع عدد رموز الدخول في الإحصاءات: قد يكون أحدهم يطلب رموزًا بكثرة.",
  },
  sms_cap_reached: {
    sentry: "Daily SMS cap reached",
    ar: "بلغت الرسائل الحد اليومي: لا رموز تحقق حتى يتجدد",
    level: "error",
    todo: "لا يستطيع أحد الدخول برمز SMS حتى منتصف الليل (غرينتش). راجع الإحصاءات: إن كان الاستخدام حقيقيًا فارفع SMS_DAILY_CAP في إعدادات Vercel، وإلا فأخبر فريق التطوير.",
  },
  sms_balance_low: {
    sentry: "SMS4FREE balance low",
    ar: "رصيد الرسائل في SMS4FREE منخفض",
    level: "warning",
    todo: "اشحن رصيد SMS4FREE قبل أن ينفد، وإلا توقفت رموز الدخول.",
  },
  unknown_workplaces: {
    sentry: "Workplace names not in the institutions list",
    ar: "أماكن عمل غير موجودة في قائمة المستشفيات",
    level: "warning",
    todo: "افتح صفحة المؤسسات. لكل اسم في القائمة: إن كان مؤسسة جديدة فأضفها، وإن كان طريقة أخرى لكتابة مؤسسة موجودة فأضفه إلى «طرق الكتابة».",
  },
  licenses_missing: {
    sentry: "Doctor licences no longer in the MoH registry",
    ar: "تراخيص أطباء لم تعد في سجل وزارة الصحة",
    level: "warning",
    todo: "صار ترخيص كل طبيب مذكور «غير موجود في السجل»، وما زال ظاهرًا في البحث. افتح ملفه، واضغط «بحث في السجل» وقارن الرقم بشهادته: إن كان خطأ فصحّحه ثم «حفظ هذا الرقم»، وإن كان صحيحًا فقد أُلغي الترخيص أو تغيّر، فتواصل معه قبل تعليق حسابه.",
  },
  profile_reported: {
    sentry: "Profile reported as impersonation",
    ar: "بلاغ عن ملف طبيب",
    level: "warning",
    todo: "افتح «البلاغات». قارن الملف المُبلَّغ عنه بسجل الوزارة وتواصل مع المُبلِّغ والطبيب صاحب الملف قبل أي إجراء؛ البلاغ وحده لا يكفي لتعليق حساب. أغلق البلاغ بملاحظة عمّا فعلت.",
  },
  db_size_high: {
    sentry: "Database past 70% of the free plan",
    ar: "قاعدة البيانات تجاوزت ٧٠٪ من حد الخطة المجانية",
    level: "warning",
    todo: "أخبر فريق التطوير: إما حذف بيانات قديمة (سجل النشاط، أحداث الاستخدام) أو الانتقال إلى خطة Supabase مدفوعة قبل بلوغ الحد.",
  },
  ratelimit_timeout: {
    sentry: "Rate limiter timed out (fail-open)",
    ar: "تأخر نظام حماية الطلبات، فسُمح بالطلبات دون فحص",
    level: "warning",
    todo: "لا شيء إن حدث مرة. إن تكرر كل ساعة فأخبر فريق التطوير: خدمة Upstash بطيئة أو متوقفة.",
  },
} as const satisfies Record<string, { sentry: string; ar: string; level: Level; todo: string }>;

export type AlertCode = keyof typeof ALERTS;

export function isAlertCode(v: unknown): v is AlertCode {
  return typeof v === "string" && v in ALERTS;
}

/** Sends one alert to Sentry and the activity log. Never throws: the
 *  action it reports has happened either way. `logOnly` goes to the
 *  activity log but not Sentry: people's names, which Sentry never gets. */
export async function raiseAlert(
  service: SupabaseClient,
  code: AlertCode,
  details: {
    level?: Level;
    extra?: Record<string, unknown>;
    logOnly?: Record<string, unknown>;
    tags?: Record<string, string>;
  } = {},
): Promise<void> {
  const { sentry, level: defaultLevel } = ALERTS[code];
  const level = details.level ?? defaultLevel;
  Sentry.captureMessage(sentry, { level, extra: details.extra, tags: details.tags });
  await writeAudit(service, { action: "alert", metadata: { alert: code, level, ...details.extra, ...details.logOnly } });
}
