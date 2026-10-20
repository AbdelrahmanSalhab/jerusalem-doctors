// The activity log in words an admin reads: what happened, in Arabic, with
// a one-line summary instead of the raw metadata. Codes stay in the
// database; this is only how /admin/audit shows them.

import { FEATURED_LABEL, type FeaturedKind } from "@/lib/directory";
import { isLicenseStatus, licenseStatusSentence, UNCHECKED_SENTENCE } from "@/lib/licenseStatus";

export interface AuditRow {
  action: string;
  metadata: Record<string, unknown> | null;
}

const STAGE: Record<string, string> = { resident: "طبيب مقيم", specialist: "طبيب أخصائي" };

const TITLE: Record<string, string> = {
  signup_verified: "تسجيل جديد",
  delete_requested: "طلب حذف حساب",
  admin_doctor_updated: "تعديل من الإدارة",
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
};

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
    case "admin_doctor_updated":
      return doctorChanges(m).join(" · ");
    case "admin_doctor_deleted":
      return "حُذفت بياناته وصورته وحساب دخوله";
    case "admin_license_rechecked":
    case "admin_license_corrected":
      return licenseCheckDetail(m);
    case "dev_password_login":
      return [m.email, m.is_admin ? "بصلاحيات إدارة" : ""].filter(Boolean).join(" · ");
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
      return `سجلات محدَّثة: ${m.rows_upserted ?? 0}${typeof m.duration_ms === "number" ? ` · ${Math.round(m.duration_ms / 1000)} ثانية` : ""}`;
    case "moh_sync_failed":
      return `سجلات محدَّثة قبل الفشل: ${m.rows_upserted ?? 0}`;
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
  career_stage: "المرحلة المهنية",
  residency_start_year: "سنة بداية التخصص",
  featured: "العرض في لوحة البحث",
  name_ar: "الاسم",
  name_he: "الاسم بالعبرية",
  kind: "النوع",
  aliases: "طرق الكتابة",
  linked: "أماكن عمل مربوطة",
  relinked: "أماكن عمل أُعيد ربطها",
  changed: "أماكن عمل تغيّر ربطها",
  unmatched: "أسماء غير مربوطة",
  rows_upserted: "سجلات محدَّثة",
  duration_ms: "المدة",
  error: "الخطأ",
  id: "المؤسسة",
  deleted_doctor_id: "رقم الحساب المحذوف",
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
  return Object.entries(row.metadata ?? {})
    .filter(([k]) => !HIDDEN_FIELDS.has(k))
    .map(([k, v]): AuditField => {
      const label = FIELD_LABEL[k] ?? k;
      if (typeof v === "boolean") return { label, value: v ? "نعم" : "لا" };
      if (v === null || v === undefined || v === "") return { label, value: "لا شيء" };
      if (Array.isArray(v)) return { label, value: v.join("، ") || "لا شيء" };
      // license_status, and license_status_before / _after from a re-check.
      if (k.startsWith("license_status")) {
        return { label, value: isLicenseStatus(v) ? licenseStatusSentence(v) : String(v) };
      }
      if (k === "career_stage") return { label, value: STAGE[String(v)] ?? String(v) };
      if (k === "featured") return { label, value: FEATURED_LABEL[v as FeaturedKind] ?? String(v) };
      if (k === "kind") return { label, value: KIND[String(v)] ?? String(v) };
      if (k === "duration_ms" && typeof v === "number") return { label, value: `${Math.round(v / 1000)} ثانية` };
      if (k === "id") return { label, value: institutionName(String(v)) ?? String(v), ltr: !institutionName(String(v)) };
      if (k === "error" || k.endsWith("_id")) return { label, value: String(v), ltr: true };
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
