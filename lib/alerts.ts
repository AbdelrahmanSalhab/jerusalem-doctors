// Alerts: what the app tells whoever runs it. Each goes to Sentry, as
// before, and to the activity log as an `alert` entry, so an admin who does
// not use Sentry sees it under التنبيهات in the admin panel.
//
// Every alert the app raises is listed here, with its Sentry message (kept
// as it was, so existing Sentry alert rules still match), the Arabic an
// admin reads, and what the admin should do about it.

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { writeAudit } from "@/lib/audit";
import { sendPushToAdmins } from "@/lib/push";

type Level = "info" | "warning" | "error";

export const ALERTS = {
  doctor_waiting: {
    sentry: "New doctor waiting for approval",
    ar: "طبيب جديد بانتظار القبول",
    level: "info",
    todo: "افتح «بانتظار الموافقة» في لوحة الإدارة، راجع الترخيص والبيانات، ثم اقبل أو ارفض.",
  },
  doctor_waiting_long: {
    sentry: "Doctor waiting for approval for over a day",
    ar: "طبيب ينتظر القبول منذ أكثر من يوم",
    level: "warning",
    todo: "افتح «بانتظار الموافقة» وراجع من ينتظر. تصل هذه التنبيهات إلى كل المشرفين لأن الإشعار الأول وصل لواحد منهم فقط.",
  },
  license_duplicate_attempt: {
    sentry: "Signup with a licence that is already registered",
    ar: "محاولة تسجيل بترخيص مسجَّل لطبيب آخر",
    level: "warning",
    todo: "افتح سجل النشاط وابحث عن «تسجيل بترخيص مسجَّل» ثم ملف الحساب الذي يحمل الترخيص. إن كان بانتظار القبول ولا تعرفه فقد يكون منتحلًا سبق الطبيب الحقيقي: تواصل مع صاحب الترخيص الحقيقي بطريقة تجدها بنفسك. وإن كان حساب طبيب مقبولًا فقد يحاول أحدهم انتحال هويته.",
  },
  doctor_renamed: {
    sentry: "Accepted doctor changed their Arabic name",
    ar: "طبيب مقبول غيّر اسمه",
    level: "info",
    todo: "افتح سجل النشاط وقارن «الاسم قبل» و«الاسم بعد». تغيير بسيط في الكتابة طبيعي؛ أما أن يصير الاسم مطابقًا لزميل آخر فيستحق مراجعة الملف وسؤاله.",
  },
  directory_heavy_use: {
    sentry: "Doctor account searching far more than usual",
    ar: "حساب طبيب يبحث في الدليل بكثرة غير معتادة",
    level: "warning",
    todo: "بلغ أحد الحسابات حد البحث اليومي (٦٠٠ بحث) أو حد إظهار أرقام الزملاء اليومي (٢٥ طبيبًا، ١٠ في أول أسبوعين). افتح ملفه من سجل النشاط: إن كان حساب طبيب حقيقي فلا شيء، وإن بدا أنه ينسخ الدليل (قُبل حديثًا، أو لا تعرفه) فعلّق حسابه.",
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
  number_requested: {
    sentry: "Doctor asked the admins for a number",
    ar: "طبيب يطلب رقم زميل",
    level: "info",
    todo: "افتح «طلبات الأرقام»، أرسل الرقم للطبيب عبر واتساب، ثم اضغط «تم».",
  },
  deletion_requested: {
    sentry: "Account deletion requested",
    ar: "طلب حذف حساب",
    level: "warning",
    todo: "أُغلق الحساب وأُخفي فورًا. افتح «حساب مغلق / طلب حذف»، وتأكد أن الطلب من صاحبه، ثم اضغط «حذف نهائي» كما تعد صفحة الخصوصية.",
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

/** The alerts that also reach an admin's phone (lib/push.ts), and the page
 *  the notification opens. The rest are for the activity log: the SMS half
 *  budget is information, the rate limiter's timeout is noise, and the
 *  unknown workplaces can wait for the next visit. A number request is only
 *  information for the log too, but someone is waiting on a reply. */
const PUSH_TO: Partial<Record<AlertCode, string>> = {
  doctor_waiting: "/admin?status=pending",
  doctor_waiting_long: "/admin?status=pending",
  directory_heavy_use: "/admin/audit",
  license_duplicate_attempt: "/admin/audit",
  doctor_renamed: "/admin/audit",
  profile_reported: "/admin/reports",
  licenses_missing: "/admin?status=license",
  sms_cap_reached: "/admin/stats",
  sms_balance_low: "/admin/stats",
  db_size_high: "/admin/stats",
  number_requested: "/admin/requests",
  deletion_requested: "/admin?status=suspended",
};

/** The alerts that go to one admin at a time, in turn, so the same person is
 *  not always the one woken for them (lib/push.ts). */
const PUSH_IN_TURN: AlertCode[] = ["doctor_waiting"];

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

  const url = PUSH_TO[code];
  if (url) {
    const push = () => sendPushToAdmins(service, { title: ALERTS[code].ar, url, tag: code }, { rotate: PUSH_IN_TURN.includes(code) });
    // After the response, so a signup does not wait for Apple's push service;
    // outside a request (after() throws there) it simply starts.
    try {
      after(push);
    } catch {
      void push();
    }
  }
}
