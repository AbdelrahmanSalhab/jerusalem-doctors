// The activity log in words an admin reads: what happened, in Arabic, with
// a one-line summary instead of the raw metadata. Codes stay in the
// database; this is only how /admin/audit shows them.

import { FEATURED_LABEL, type FeaturedKind } from "@/lib/directory";

export interface AuditRow {
  action: string;
  metadata: Record<string, unknown> | null;
}

const LICENSE_STATUS: Record<string, string> = {
  verified: "الترخيص مطابق لسجل الوزارة",
  soft_match: "تطابق تقريبي مع السجل",
  not_found: "الترخيص غير موجود في السجل",
  name_mismatch_overridden: "الاسم لا يطابق السجل (تجاوزه الطبيب)",
};

const STAGE: Record<string, string> = { resident: "طبيب مقيم", specialist: "طبيب أخصائي" };

const TITLE: Record<string, string> = {
  signup_verified: "تسجيل جديد",
  delete_requested: "طلب حذف حساب",
  admin_doctor_updated: "تعديل من الإدارة",
  admin_doctor_deleted: "حذف نهائي لحساب",
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
  if ("is_admin_approved" in m) out.push(m.is_admin_approved ? "فُعّل الحساب" : "أُلغي التفعيل");
  if ("is_active" in m) out.push(m.is_active ? "أُعيد تنشيط الحساب" : "عُلّق الحساب");
  if ("is_visible" in m) out.push(m.is_visible ? "أُظهر في الدليل" : "أُخفي من الدليل");
  if ("career_stage" in m) out.push(`المرحلة: ${m.career_stage ? STAGE[String(m.career_stage)] ?? m.career_stage : "طب عام"}`);
  if (m.residency_start_year) out.push(`بداية التخصص: ${m.residency_start_year}`);
  if ("featured" in m) {
    out.push(m.featured ? `عُرض في «${FEATURED_LABEL[m.featured as FeaturedKind] ?? m.featured}»` : "أُزيل من المعروضين");
  }
  return out;
}

/**
 * One line of detail. `institutionName` resolves an institution id for the
 * entries that only stored the id.
 */
export function auditDetail(row: AuditRow, institutionName: (id: string) => string | undefined): string {
  const m = row.metadata ?? {};
  switch (row.action) {
    case "signup_verified": {
      const status = LICENSE_STATUS[String(m.license_status)] ?? "";
      const approval = m.auto_approved ? "فُعّل تلقائيًا" : "بانتظار موافقة الإدارة";
      return [approval, status].filter(Boolean).join(" · ");
    }
    case "delete_requested":
      return "أُخفي من البحث، بانتظار إتمام الحذف";
    case "admin_doctor_updated":
      return doctorChanges(m).join(" · ");
    case "admin_doctor_deleted":
      return "حُذفت بياناته وصورته وحساب دخوله";
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
