// Arabic wording for a failed send's reason (lib/otp/failure.ts), for the
// admin pages. Says what to do where there is something to do.

const SMS4FREE_STATUS_TEXT: Record<string, string> = {
  "0": "خطأ عام من SMS4FREE",
  "-1": "بيانات الدخول إلى SMS4FREE خاطئة",
  "-2": "اسم المرسل غير مقبول في SMS4FREE",
  "-3": "لا مستلم للرسالة",
  "-4": "نفد رصيد الرسائل: اشحنه",
  "-5": "SMS4FREE رفضت نص الرسالة",
  "-6": "رقم المرسل غير موثّق في SMS4FREE",
};

export function failureText(reason: string): string {
  if (reason === "daily_cap") return "تجاوز الحد اليومي للرسائل (SMS_DAILY_CAP)";
  if (reason === "our_rate_limit") return "أوقفها حدّنا قبل الإرسال (٥ طلبات في الساعة لكل رقم، أو كثرة الطلبات من عنوان واحد)";
  if (reason === "turnstile_failed") return "فشل التحقق من المتصفح (Turnstile) قبل الإرسال";
  if (reason === "sms4free_timeout") return "انتهت مهلة SMS4FREE (ربما أُرسلت الرسالة)";
  if (reason === "sms4free_unreadable") return "ردّ SMS4FREE غير مفهوم";
  if (reason === "number_not_deliverable") return "رقم لا تصله الرسائل";
  if (reason === "provider_config") return "إعداد مزوّد الرسائل ناقص أو خاطئ";
  const status = reason.match(/^sms4free_status_(-?\d+)$/)?.[1];
  if (status !== undefined) return SMS4FREE_STATUS_TEXT[status] ?? `SMS4FREE رفضت الإرسال (${status})`;
  const http = reason.match(/^sms4free_http_(\d+)$/)?.[1];
  if (http) return `خطأ HTTP ${http} من SMS4FREE`;
  if (reason === "supabase_over_sms_send_rate_limit") return "حدّ Supabase للرسائل: ساعة كاملة أو 60 ثانية لنفس الرقم";
  const supa = reason.match(/^supabase_(.+)$/)?.[1];
  if (supa) return `Supabase رفضت الطلب (${supa})`;
  return "سبب غير مسجّل";
}
