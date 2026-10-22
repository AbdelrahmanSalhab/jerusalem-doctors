// The activity log in words an admin reads: what happened, in Arabic, with
// a one-line summary instead of the raw metadata. Codes stay in the
// database; this is only how /admin/audit shows them.

import { ALERTS, isAlertCode } from "@/lib/alerts";
import { FIELD_LABELS } from "@/lib/client/apiError";
import { FEATURED_LABEL, type FeaturedKind } from "@/lib/directory";
import { isLicenseStatus, licenseStatusSentence, UNCHECKED_SENTENCE } from "@/lib/licenseStatus";

export interface AuditRow {
  action: string;
  metadata: Record<string, unknown> | null;
}

const LEVEL: Record<string, string> = { info: "للعلم", warning: "تحذير", error: "عاجل" };

/** Names shown in an alert's one-line summary before "و N غيرها". */
const ALERT_NAMES_SHOWN = 3;

/** "عاجل · بلغت الرسائل الحد اليومي …", with who or what it is about, or
 *  else the one number that matters. */
function alertDetail(m: Record<string, unknown>): string {
  const what = isAlertCode(m.alert) ? ALERTS[m.alert].ar : String(m.alert ?? "");
  const names = Array.isArray(m.names) ? (m.names as string[]) : [];
  const more = names.length - ALERT_NAMES_SHOWN;
  const about =
    names.length > 0
      ? names.slice(0, ALERT_NAMES_SHOWN).join("، ") + (more > 0 ? ` و${more} غيرها` : "")
      : [m.balance, m.count, m.flagged].find((x) => typeof x === "number");
  return [LEVEL[String(m.level)], what, about === undefined ? "" : String(about)].filter(Boolean).join(" · ");
}

const STAGE: Record<string, string> = { resident: "طبيب مقيم", specialist: "طبيب أخصائي" };

const TITLE: Record<string, string> = {
  signup_verified: "تسجيل جديد",
  delete_requested: "طلب حذف حساب",
  number_request_resolved: "إرسال رقم طبيب مطلوب",
  profile_reported: "بلاغ عن ملف",
  profile_report_resolved: "إغلاق بلاغ",
  unfinished_signup_reminded: "تذكير بتسجيل لم يكتمل",
  unfinished_signup_deleted: "حذف تسجيل لم يكتمل",
  admin_doctor_updated: "تعديل من الإدارة",
  admin_doctor_profile_edited: "تعديل الملف من الإدارة",
  admin_doctor_photo_changed: "تغيير الصورة من الإدارة",
  admin_doctor_deleted: "حذف نهائي لحساب",
  admin_license_rechecked: "إعادة فحص الترخيص",
  admin_license_corrected: "تصحيح رقم الترخيص",
  dev_password_login: "دخول فريق التطوير بكلمة مرور",
  institution_created: "إضافة مؤسسة",
  institution_updated: "تعديل مؤسسة",
  institution_deleted: "حذف مؤسسة",
  institutions_relinked: "فحص يومي للمستشفيات",
  moh_sync_completed: "مزامنة سجل وزارة الصحة",
  moh_sync_failed: "فشل مزامنة سجل وزارة الصحة",
  license_missing_from_registry: "الترخيص لم يعد في سجل الوزارة",
  alert: "تنبيه",
};

/** Every action the log knows a name for, in the order above. */
export const AUDIT_ACTIONS = Object.keys(TITLE);

export function auditTitle(action: string): string {
  return TITLE[action] ?? action;
}

const quote = (s: unknown) => `«${String(s)}»`;

/** What an admin changed on a doctor, one phrase per field. */
function doctorChanges(m: Record<string, unknown>): string[] {
  const out: string[] = [];
  // Worded like the three switches on /admin, where "قبول العضوية" (the gate
  // into the directory) and "الحساب" (open or closed) used to read as the
  // same word and left admins guessing which one they had just pressed.
  if ("is_admin_approved" in m) out.push(m.is_admin_approved ? "قُبلت العضوية" : "سُحب قبول العضوية");
  if ("is_active" in m) out.push(m.is_active ? "فُتح الحساب" : "أُغلق الحساب");
  if ("is_visible" in m) out.push(m.is_visible ? "أُظهر في الدليل" : "أُخفي من الدليل");
  if ("career_stage" in m) out.push(`المرحلة: ${m.career_stage ? STAGE[String(m.career_stage)] ?? m.career_stage : "طب عام"}`);
  if (m.residency_start_year) out.push(`بداية التخصص: ${m.residency_start_year}`);
  if ("featured" in m) {
    out.push(m.featured ? `عُرض في «${FEATURED_LABEL[m.featured as FeaturedKind] ?? m.featured}»` : "أُزيل من المعروضين");
  }
  if (m.approval_reason) out.push(`السبب: ${quote(m.approval_reason)}`);
  return out;
}

/** Columns an admin's profile edit writes that are not fields they typed:
 *  the search copies, which would read as duplicates in the log. */
const DERIVED = /_normalized$/;

const AUTH_SYNC: Record<string, string> = {
  updated: "نُقل حساب الدخول إلى الرقم الجديد",
  no_login_account: "لا يوجد حساب دخول مرتبط بعد",
  rolled_back: "أُعيد حساب الدخول إلى الرقم السابق",
};

/** What an admin changed on a doctor's profile: which fields, and the
 *  before/after of the two that identify them. */
function profileEditDetail(m: Record<string, unknown>): string {
  const parts: string[] = [];
  const fields = Array.isArray(m.fields) ? (m.fields as string[]) : [];
  const named = [
    ...new Set(
      fields
        .filter((f) => !DERIVED.test(f) && f !== "phone_display")
        .map((f) => FIELD_LABELS[f] ?? f),
    ),
  ];
  if (named.length > 0) parts.push(named.join("، "));
  if (typeof m.workplaces === "number") parts.push(`أماكن العمل: ${m.workplaces}`);
  if (typeof m.specialties === "number") parts.push(`التخصصات: ${m.specialties}`);
  if (m.phone_changed) {
    parts.push(`الهاتف: ${quote(m.phone_before)} ← ${quote(m.phone_after)}`);
    if (m.phone_not_sms_deliverable) parts.push("لا يصله رمز الدخول");
    const sync = AUTH_SYNC[String(m.auth_sync)];
    if (sync) parts.push(sync);
  }
  if (m.hebrew_name_changed) parts.push("يحتاج إعادة فحص الترخيص");
  return parts.join(" · ");
}

/** An admin re-checking or correcting a licence number. */
function licenseCheckDetail(m: Record<string, unknown>): string {
  const parts: string[] = [];
  if (m.slot === "secondary") parts.push("الترخيص الإضافي");
  if (m.license_number_before && m.license_number_before !== m.license_number_after) {
    parts.push(`الرقم: ${quote(m.license_number_before)} ← ${quote(m.license_number_after)}`);
  } else if (m.license_number) {
    parts.push(`الرقم: ${quote(m.license_number)}`);
  }
  const before = isLicenseStatus(m.license_status_before) ? licenseStatusSentence(m.license_status_before) : null;
  const after = isLicenseStatus(m.license_status_after) ? licenseStatusSentence(m.license_status_after) : null;
  if (after && before !== after) parts.push(`${before ?? UNCHECKED_SENTENCE} ← ${after}`);
  else if (after) parts.push(after);
  if (m.adopted_registry_name) {
    parts.push(`الاسم العبري: ${quote(m.hebrew_name_before)} ← ${quote(m.hebrew_name_after)} (كتابة السجل)`);
  }
  if (m.reason) parts.push(`السبب: ${quote(m.reason)}`);
  return parts.join(" · ");
}

/**
 * One line of detail. `institutionName` resolves an institution id for the
 * entries that only stored the id.
 */
export function auditDetail(row: AuditRow, institutionName: (id: string) => string | undefined): string {
  const m = row.metadata ?? {};
  switch (row.action) {
    case "signup_verified": {
      const status = isLicenseStatus(m.license_status) ? licenseStatusSentence(m.license_status) : "";
      const approval = m.auto_approved ? "فُعّل تلقائيًا" : "بانتظار موافقة الإدارة";
      return [approval, status].filter(Boolean).join(" · ");
    }
    case "delete_requested":
      return "أُخفي من البحث، بانتظار إتمام الحذف";
    case "number_request_resolved":
      return quote(m.query);
    case "profile_reported":
      return m.source === "card" ? "من بطاقة طبيب" : "من نموذج الإبلاغ";
    case "profile_report_resolved":
      return quote(m.note);
    case "unfinished_signup_reminded":
    case "unfinished_signup_deleted":
      return typeof m.name === "string" ? `د. ${m.name}` : "";
    case "admin_doctor_updated":
      return doctorChanges(m).join(" · ");
    case "admin_doctor_profile_edited":
      return profileEditDetail(m);
    case "admin_doctor_photo_changed":
      return m.removed ? "حُذفت الصورة الشخصية" : "رُفعت صورة شخصية جديدة";
    case "admin_doctor_deleted":
      return "حُذفت بياناته وصورته وحساب دخوله";
    case "admin_license_rechecked":
    case "admin_license_corrected":
      return licenseCheckDetail(m);
    case "dev_password_login":
      return [m.ci_run ? "اختبار آلي (CI)" : "", m.email, m.is_admin ? "بصلاحيات إدارة" : ""].filter(Boolean).join(" · ");
    case "institution_created":
      return [quote(m.name_ar), typeof m.linked === "number" ? `أماكن عمل مربوطة: ${m.linked}` : ""]
        .filter(Boolean)
        .join(" · ");
    case "institution_updated": {
      const name = (m.name_ar as string | undefined) ?? institutionName(String(m.id));
      const parts = [name ? quote(name) : ""];
      if (Array.isArray(m.aliases)) parts.push(`طرق الكتابة: ${(m.aliases as string[]).join("، ")}`);
      if (m.kind) parts.push(`النوع: ${m.kind === "hospital" ? "مستشفى" : m.kind === "hmo" ? "صندوق مرضى" : "شبكة عيادات"}`);
      if (typeof m.linked === "number" && m.linked > 0) parts.push(`أماكن عمل أُعيد ربطها: ${m.linked}`);
      return parts.filter(Boolean).join(" · ");
    }
    case "institution_deleted":
      return quote(m.name_ar);
    case "institutions_relinked":
      return `أماكن عمل تغيّر ربطها: ${m.changed ?? 0} · أسماء غير مربوطة: ${m.unmatched ?? 0}`;
    case "moh_sync_completed":
      return [
        `تراخيص محدَّثة: ${m.rows_upserted ?? 0}`,
        // Our doctors' licences the registry no longer lists.
        m.scope === "full" ? "السجل كاملًا" : "",
        typeof m.missing === "number" && m.missing > 0 ? `غير موجودة في السجل: ${m.missing}` : "",
        typeof m.duration_ms === "number" ? `${Math.round(m.duration_ms / 1000)} ثانية` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    case "alert":
      return alertDetail(m);
    case "moh_sync_failed":
      return typeof m.error === "string" ? m.error : "";
    default:
      return "";
  }
}

/** "19/10/2026 14:53" in Jerusalem time. */
export function auditTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(",", "");
}

const FIELD_LABEL: Record<string, string> = {
  auto_approved: "موافقة تلقائية",
  license_status: "نتيجة التحقق من الترخيص",
  is_admin_approved: "قبول العضوية",
  is_active: "الحساب",
  is_visible: "الظهور في الدليل",
  approval_reason: "سبب القبول",
  license_status_at_approval: "حالة الترخيص عند القبول",
  slot: "الترخيص",
  license_number: "رقم الترخيص",
  license_number_before: "الرقم قبل",
  license_number_after: "الرقم بعد",
  license_status_before: "الحالة قبل",
  license_status_after: "الحالة بعد",
  source: "مصدر النتيجة",
  match_first: "مطابقة الاسم الأول",
  match_family: "مطابقة اسم العائلة",
  candidates: "القراءات المحتملة للرقم",
  override_name_mismatch: "حُفظ رغم اختلاف الاسم",
  registry_first_name: "الاسم الأول في السجل",
  registry_family_name: "اسم العائلة في السجل",
  reason: "السبب",
  email: "البريد الإلكتروني",
  ci_run: "تشغيل الاختبار الآلي",
  career_stage: "المرحلة المهنية",
  residency_start_year: "سنة بداية التخصص",
  featured: "العرض في لوحة البحث",
  name_ar: "الاسم",
  name: "الاسم",
  name_he: "الاسم بالعبرية",
  kind: "النوع",
  aliases: "طرق الكتابة",
  linked: "أماكن عمل مربوطة",
  relinked: "أماكن عمل أُعيد ربطها",
  changed: "أماكن عمل تغيّر ربطها",
  unmatched: "أسماء غير مربوطة",
  rows_upserted: "تراخيص محدَّثة",
  missing: "تراخيص لم تعد في السجل",
  alert: "التنبيه",
  level: "الأهمية",
  balance: "الرصيد",
  threshold: "حد التنبيه",
  limit: "الحد اليومي",
  count: "العدد",
  names: "الأسماء",
  key: "النوع",
  flagged: "أُحيلت للمراجعة",
  report_id: "رقم البلاغ",
  note: "الملاحظة",
  doctor_ids: "أرقام حسابات الأطباء",
  licenses: "أرقام التراخيص",
  scope: "النطاق",
  duration_ms: "المدة",
  error: "الخطأ",
  id: "المؤسسة",
  deleted_doctor_id: "رقم الحساب المحذوف",
  fields: "الحقول المعدَّلة",
  workplaces: "عدد أماكن العمل",
  specialties: "عدد التخصصات",
  hebrew_name_changed: "تغيّر الاسم بالعبرية",
  phone_changed: "تغيّر رقم الهاتف",
  phone_before: "الهاتف قبل",
  phone_after: "الهاتف بعد",
  phone_not_sms_deliverable: "لا يصله رمز الدخول",
  auth_sync: "حساب الدخول",
  removed: "حُذفت الصورة",
};

/** Kept for the record but never shown to admins. */
const HIDDEN_FIELDS = new Set(["ip"]);

const KIND: Record<string, string> = { hospital: "مستشفى", hmo: "صندوق مرضى", clinic_network: "شبكة عيادات" };

export interface AuditField {
  label: string;
  value: string;
  /** Ids and technical values read left to right. */
  ltr?: boolean;
}

/** Everything an entry stored, labelled in Arabic, for the expanded view. */
export function auditFields(row: AuditRow, institutionName: (id: string) => string | undefined): AuditField[] {
  const code = row.metadata?.alert;
  const todo = row.action === "alert" && isAlertCode(code) ? [{ label: "ما العمل", value: ALERTS[code].todo }] : [];
  return [...metadataFields(row, institutionName), ...todo];
}

function metadataFields(row: AuditRow, institutionName: (id: string) => string | undefined): AuditField[] {
  return Object.entries(row.metadata ?? {})
    .filter(([k]) => !HIDDEN_FIELDS.has(k))
    .map(([k, v]): AuditField => {
      const label = FIELD_LABEL[k] ?? k;
      if (typeof v === "boolean") return { label, value: v ? "نعم" : "لا" };
      if (v === null || v === undefined || v === "") return { label, value: "لا شيء" };
      // The edited-columns list, in the same Arabic the form uses.
      if (k === "fields" && Array.isArray(v)) {
        const named = [...new Set((v as string[]).map((f) => FIELD_LABELS[f] ?? f))];
        return { label, value: named.join("، ") || "لا شيء" };
      }
      if (Array.isArray(v)) return { label, value: v.join("، ") || "لا شيء" };
      // license_status, and license_status_before / _after from a re-check.
      if (k.startsWith("license_status")) {
        return { label, value: isLicenseStatus(v) ? licenseStatusSentence(v) : String(v) };
      }
      if (k === "career_stage") return { label, value: STAGE[String(v)] ?? String(v) };
      if (k === "alert") return { label, value: isAlertCode(v) ? ALERTS[v].ar : String(v) };
      if (k === "level") return { label, value: LEVEL[String(v)] ?? String(v) };
      if (k === "source" && (v === "card" || v === "public")) {
        return { label: "المصدر", value: v === "card" ? "بطاقة طبيب" : "نموذج الإبلاغ" };
      }
      if (k === "scope") return { label, value: v === "full" ? "السجل كاملًا" : "تراخيص أطبائنا فقط" };
      if (k === "featured") return { label, value: FEATURED_LABEL[v as FeaturedKind] ?? String(v) };
      if (k === "kind") return { label, value: KIND[String(v)] ?? String(v) };
      if (k === "auth_sync") return { label, value: AUTH_SYNC[String(v)] ?? String(v) };
      if (k === "duration_ms" && typeof v === "number") return { label, value: `${Math.round(v / 1000)} ثانية` };
      if (k === "id") return { label, value: institutionName(String(v)) ?? String(v), ltr: !institutionName(String(v)) };
      if (k === "error" || k === "ci_run" || k.endsWith("_id")) return { label, value: String(v), ltr: true };
      if (typeof v === "object") return { label, value: JSON.stringify(v), ltr: true };
      return { label, value: String(v) };
    });
}

/** "19/10/2026 11:53:17" in Jerusalem time, for the expanded view. */
export function auditTimeFull(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(",", "");
}
