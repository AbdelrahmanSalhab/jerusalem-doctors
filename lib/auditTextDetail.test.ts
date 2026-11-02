// Every audit action in plain Arabic: the one-line detail and the expanded
// fields, branch by branch.

import { describe, expect, it } from "vitest";
import { auditDetail, auditFields, auditTimeFull } from "./auditText";

const none = () => undefined;
const detail = (action: string, metadata?: Record<string, unknown> | null) =>
  auditDetail({ action, metadata } as Parameters<typeof auditDetail>[0], none);
const fields = (metadata: Record<string, unknown>, institutionName: (id: string) => string | undefined = none) =>
  auditFields({ action: "x", metadata } as Parameters<typeof auditFields>[0], institutionName);
const value = (k: string, v: unknown, inst?: (id: string) => string | undefined) => fields({ [k]: v }, inst)[0];

describe("auditDetail", () => {
  it("covers the simple actions", () => {
    expect(detail("delete_requested")).toContain("بانتظار إتمام الحذف");
    expect(detail("number_request_resolved", { query: "اس" })).toBe("«اس»");
    expect(detail("profile_reported", { source: "card" })).toBe("من بطاقة طبيب");
    expect(detail("profile_reported", { source: "public" })).toBe("من نموذج الإبلاغ");
    expect(detail("profile_report_resolved", { note: "تم" })).toBe("«تم»");
    expect(detail("unfinished_signup_reminded", { name: "سارة" })).toBe("د. سارة");
    expect(detail("unfinished_signup_deleted", {})).toBe("");
    expect(detail("admin_doctor_deleted")).toContain("حُذفت بياناته");
    expect(detail("ci_login")).toContain("CI");
    expect(detail("admin_license_reviewed", { license_status: "not_found", note: "تحققت من الشهادة" })).toBe("الترخيص غير موجود في السجل · الملاحظة: «تحققت من الشهادة»");
    expect(detail("admin_license_reviewed", {})).toBe("");
    expect(detail("admin_doctor_photo_changed", { removed: true })).toContain("حُذفت");
    expect(detail("admin_doctor_photo_changed", {})).toContain("رُفعت");
    expect(detail("moh_sync_failed", { error: "boom" })).toBe("boom");
    expect(detail("moh_sync_failed", {})).toBe("");
    expect(detail("something_new")).toBe("");
    expect(detail("signup_verified", null)).toBe("بانتظار موافقة الإدارة");
  });

  it("lists what an admin switched on a doctor", () => {
    const out = detail("admin_doctor_updated", {
      is_admin_approved: false,
      is_active: true,
      is_visible: false,
      career_stage: null,
      residency_start_year: 2022,
      featured: "doctor",
      approval_reason: "اتصلنا",
    });
    for (const part of ["سُحب قبول العضوية", "فُتح الحساب", "أُخفي من الدليل", "المرحلة: طب عام", "بداية التخصص: 2022", "عُرض في", "السبب: «اتصلنا»"]) {
      expect(out).toContain(part);
    }
    const other = detail("admin_doctor_updated", { is_admin_approved: true, is_active: false, is_visible: true, career_stage: "resident", featured: null });
    for (const part of ["قُبلت العضوية", "أُغلق الحساب", "أُظهر في الدليل", "أُزيل من المعروضين"]) expect(other).toContain(part);
    expect(detail("admin_doctor_updated", { career_stage: "unknown_stage", featured: "odd" })).toContain("unknown_stage");
  });

  it("describes a profile edit: fields, counts and a changed phone", () => {
    const out = detail("admin_doctor_profile_edited", {
      fields: ["bio", "bio_normalized", "phone_display", "not_a_known_field"],
      workplaces: 2,
      specialties: 3,
      phone_changed: true,
      phone_before: "050",
      phone_after: "052",
      phone_not_sms_deliverable: true,
      auth_sync: "updated",
      hebrew_name_changed: true,
    });
    for (const part of ["not_a_known_field", "أماكن العمل: 2", "التخصصات: 3", "«050» ← «052»", "لا يصله رمز الدخول", "نُقل حساب الدخول", "إعادة فحص الترخيص"]) {
      expect(out).toContain(part);
    }
    expect(detail("admin_doctor_profile_edited", { phone_changed: true, phone_before: "a", phone_after: "b", auth_sync: "weird" })).not.toContain("نُقل");
    expect(detail("admin_doctor_profile_edited", {})).toBe("");
  });

  it("describes a licence re-check or correction", () => {
    expect(detail("admin_license_corrected", {
      slot: "secondary",
      license_number_before: "1",
      license_number_after: "2",
      license_status_before: "not_found",
      license_status_after: "verified",
      adopted_registry_name: true,
      hebrew_name_before: "א",
      hebrew_name_after: "ב",
      reason: "خطأ",
    })).toEqual(expect.stringContaining("الترخيص الإضافي"));
    expect(detail("admin_license_rechecked", { license_number: "5", license_status_after: "verified" })).toContain("الرقم: «5»");
    expect(detail("admin_license_rechecked", { license_number_before: "5", license_number_after: "5", license_status_before: "verified", license_status_after: "verified" })).not.toContain("←");
    expect(detail("admin_license_rechecked", { license_status_after: "verified" })).toContain("←");
  });

  it("describes institutions", () => {
    expect(detail("institution_created", { name_ar: "المقاصد", linked: 3 })).toBe("«المقاصد» · أماكن عمل مربوطة: 3");
    expect(detail("institution_created", { name_ar: "المقاصد" })).toBe("«المقاصد»");
    const updated = detail("institution_updated", { id: "i1", aliases: ["أ", "ب"], kind: "hmo", linked: 2 });
    for (const part of ["طرق الكتابة: أ، ب", "صندوق مرضى", "أعيد ربطها: 2".replace("أعيد", "أُعيد")]) expect(updated).toContain(part);
    expect(detail("institution_updated", { name_ar: "ن", kind: "hospital" })).toContain("مستشفى");
    expect(detail("institution_updated", { name_ar: "ن", kind: "chain" })).toContain("شبكة عيادات");
    expect(auditDetail({ action: "institution_updated", metadata: { id: "i1" } }, () => "الاسم")).toBe("«الاسم»");
    expect(detail("institution_deleted", { name_ar: "ن" })).toBe("«ن»");
    expect(detail("institutions_relinked", { changed: 2 })).toBe("أماكن عمل تغيّر ربطها: 2 · أسماء غير مربوطة: 0");
    expect(detail("institutions_relinked", {})).toContain("0 · ");
  });

  it("describes a registry sync and an alert", () => {
    expect(detail("moh_sync_completed", {})).toBe("تراخيص محدَّثة: 0");
    const done = detail("moh_sync_completed", { rows_upserted: 9, scope: "full", missing: 2, duration_ms: 4000 });
    for (const part of ["تراخيص محدَّثة: 9", "السجل كاملًا", "غير موجودة في السجل: 2", "4 ثانية"]) expect(done).toContain(part);
    expect(detail("alert", { alert: "sms_balance_low", level: "warning", balance: 7 })).toContain("7");
    expect(detail("alert", { alert: "some_new_code", level: "info", names: ["أ", "ب", "ج", "د", "هـ"] })).toContain("و2 غيرها");
    expect(detail("alert", { alert: "x", names: ["أ"] })).toContain("أ");
    expect(detail("alert", {})).toBe("");
    expect(detail("alert", { alert: "x", institutions: ["مؤسسة"] })).toContain("مؤسسة");
  });

  it("describes a password login, with or without CI", () => {
    expect(detail("dev_password_login", { ci_run: "u", email: "e", is_admin: true })).toBe("اختبار آلي (CI) · e · بصلاحيات إدارة");
  });
});

describe("auditFields", () => {
  it("labels booleans, empties, lists and objects", () => {
    expect(value("is_active", true).value).toBe("نعم");
    expect(value("is_active", false).value).toBe("لا");
    expect(value("note", "").value).toBe("لا شيء");
    expect(value("note", null).value).toBe("لا شيء");
    expect(value("tags", ["a", "b"]).value).toBe("a، b");
    expect(value("tags", []).value).toBe("لا شيء");
    expect(value("fields", ["bio", "bio"]).value).toBeTruthy();
    expect(value("fields", []).value).toBe("لا شيء");
    expect(value("extra", { a: 1 })).toMatchObject({ value: '{"a":1}', ltr: true });
    expect(value("extra", 5).value).toBe("5");
  });

  it("words the coded fields", () => {
    expect(value("license_status_after", "verified").value).toContain("مطابق");
    expect(value("license_status", "weird").value).toBe("weird");
    expect(value("career_stage", "resident").value).not.toBe("resident");
    expect(value("career_stage", "odd").value).toBe("odd");
    expect(value("alert", "sms_balance_low").value).not.toBe("sms_balance_low");
    expect(value("alert", "new").value).toBe("new");
    expect(value("level", "error").value).toBe("عاجل");
    expect(value("level", "odd").value).toBe("odd");
    expect(value("source", "card")).toMatchObject({ label: "المصدر", value: "بطاقة طبيب" });
    expect(value("source", "public").value).toBe("نموذج الإبلاغ");
    expect(value("scope", "full").value).toBe("السجل كاملًا");
    expect(value("scope", "ours").value).toBe("تراخيص أطبائنا فقط");
    expect(value("featured", "doctor").value).not.toBe("doctor");
    expect(value("featured", "odd").value).toBe("odd");
    expect(value("kind", "hmo").value).not.toBe("hmo");
    expect(value("kind", "odd").value).toBe("odd");
    expect(value("auth_sync", "updated").value).toContain("نُقل");
    expect(value("auth_sync", "odd").value).toBe("odd");
    expect(value("duration_ms", 2400).value).toBe("2 ثانية");
  });

  it("resolves an institution id to its name, and shows an unknown id left to right", () => {
    expect(value("id", "i1", () => "المقاصد")).toMatchObject({ value: "المقاصد", ltr: false });
    expect(value("id", "i1")).toMatchObject({ value: "i1", ltr: true });
    expect(value("error", "boom")).toMatchObject({ ltr: true });
    expect(value("target_doctor_id", "x")).toMatchObject({ ltr: true });
  });

  it("adds what to do for a known alert", () => {
    const out = auditFields({ action: "alert", metadata: { alert: "sms_balance_low" } } as never, none);
    expect(out.at(-1)?.label).toBe("ما العمل");
  });

  it("handles a row with no metadata", () => {
    expect(auditFields({ action: "x", metadata: null } as never, none)).toEqual([]);
  });
});

describe("auditTimeFull", () => {
  it("shows seconds in Jerusalem time", () => {
    expect(auditTimeFull("2026-10-19T08:53:17Z")).toContain("11:53:17");
  });
});
