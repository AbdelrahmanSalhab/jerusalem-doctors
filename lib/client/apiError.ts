// Arabic text for the error codes our API routes answer with. Forms show
// this instead of the raw code (which is English and meant for logs).

const MESSAGES: Record<string, string> = {
  rate_limited: "عدد كبير من المحاولات. انتظر قليلًا ثم حاول مجددًا.",
  turnstile_failed: "لم يكتمل التحقق من المتصفح. تأكد من الاتصال وأعد المحاولة.",
  otp_send_failed: "تعذّر إرسال رمز التحقق. حاول بعد دقيقة.",
  phone_auth_disabled: "التسجيل والدخول متوقفان مؤقتًا. حاول لاحقًا.",
  phone_unsupported: "رقم الهاتف غير مدعوم. أدخل رقم هاتف محمول إسرائيليًا (+972).",
  invalid_phone: "صيغة رقم الهاتف غير صحيحة.",
  invalid_license: "صيغة رقم الترخيص غير صحيحة.",
  duplicate: "رقم الترخيص مُسجّل مسبقًا. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.",
  license_name_mismatch: "الاسم العبري لا يطابق سجل وزارة الصحة.",
  invalid_body: "بعض الحقول غير صحيحة. راجع الحقول المعلَّمة وحاول مجددًا.",
  exactly_one_primary: "اختر مكان عمل رئيسيًا واحدًا فقط.",
  unauthenticated: "انتهت جلستك. سجّل الدخول من جديد.",
  // Deliberately says no more than the server does: the route answers the
  // same way whether the address is unknown or the password is wrong.
  invalid_credentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  update_failed: "تعذّر حفظ التغييرات. حاول مجددًا.",
  not_found: "لم نجد هذا الحساب. ربما حُذف.",
  no_fields: "لا يوجد تغيير لحفظه.",
  approval_reason_required: "اكتب سبب قبول هذا الطبيب؛ ترخيصه ليس مطابقًا لسجل الوزارة.",
  still_active: "أغلق الحساب أولًا؛ الحذف النهائي متاح للحسابات المغلقة فقط.",
  cannot_delete_self: "لا يمكنك حذف حسابك أنت.",
  delete_failed: "تعذّر الحذف. حاول مجددًا.",
  moh_unavailable: "تعذّر الوصول إلى سجل وزارة الصحة الآن (data.gov.il). هذا انقطاع مؤقت ولا يعني أن الرقم غير موجود. حاول بعد قليل.",
  duplicate_license: "رقم الترخيص مسجَّل مسبقًا لطبيب آخر. لا يمكن أن يحمل رقمًا واحدًا طبيبان.",
  result_changed: "تغيّرت نتيجة البحث. راجع النتيجة الجديدة ثم احفظ.",
  name_not_adoptable: "لم تعد كتابة السجل تحلّ الفرق في الاسم. ابحث من جديد وراجع النتيجة.",
  name_mismatch: "الرقم يخصّ اسمًا آخر في السجل. تأكد من الرقم قبل الحفظ.",
  duplicate_phone: "رقم الهاتف مسجَّل مسبقًا لطبيب آخر.",
  phone_not_sms_deliverable: "لن يصل رمز الدخول إلى هذا الرقم.",
  auth_update_failed: "تعذّر تحديث حساب الدخول المرتبط بالرقم. حاول مجددًا.",
  upload_failed: "تعذّر رفع الصورة. حاول لاحقًا.",
  unsupported_type: "نوع الملف غير مدعوم. استخدم JPG أو PNG أو WebP.",
  file_too_large: "حجم الصورة أكبر من 2 ميغابايت.",
  internal_error: "حدث خطأ في الخادم. حاول بعد قليل.",
};

export function apiErrorMessage(code: unknown, fallback = "حدث خطأ. الرجاء المحاولة مجددًا."): string {
  return (typeof code === "string" && MESSAGES[code]) || fallback;
}

/** Field names in Arabic. Exported because the activity log names the same
 *  fields an admin just edited. */
export const FIELD_LABELS: Record<string, string> = {
  phone: "رقم الهاتف",
  license_number: "رقم الترخيص",
  approval_reason: "سبب القبول",
  secondary_license_number: "رقم الترخيص الإضافي",
  secondary_license_region: "جهة الترخيص الإضافي",
  hebrew_full_name: "الاسم بالعبرية",
  hebrew_first_name: "الاسم الأول بالعبرية",
  hebrew_family_name: "اسم العائلة بالعبرية",
  arabic_first_name: "الاسم الأول",
  arabic_family_name: "اسم العائلة",
  email: "البريد الإلكتروني",
  subspecialty: "التخصص الدقيق",
  bio: "النبذة",
  specialty_ids: "التخصصات",
  career_stage: "المرحلة المهنية",
  residency_start_year: "سنة بداية التخصص",
  workplaces: "أماكن العمل",
  certificates: "الشهادات",
  consent: "الموافقة على الشروط",
  phone_e164: "رقم الهاتف",
  phone_display: "صيغة عرض الهاتف",
  is_phone_verified: "توثيق الهاتف",
  seeking_work: "يبحث عن عمل",
  retired: "متقاعد",
  profile_picture_url: "الصورة الشخصية",
};

/** The server's first field error, prefixed with the field's Arabic name. */
export function fieldErrorMessage(fields: Record<string, string> | undefined): string | null {
  const [path, message] = Object.entries(fields ?? {})[0] ?? [];
  if (!path || !message) return null;
  const label = FIELD_LABELS[path.split(".")[0]];
  return label ? `${label}: ${message}` : message;
}
