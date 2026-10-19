import { describe, expect, it } from "vitest";
import { auditDetail, auditTime, auditTitle } from "./auditText";

const none = () => undefined;

describe("audit log text", () => {
  it("names the event in Arabic, keeping unknown codes", () => {
    expect(auditTitle("signup_verified")).toBe("تسجيل جديد");
    expect(auditTitle("something_new")).toBe("something_new");
  });

  it("summarises a signup", () => {
    expect(auditDetail({ action: "signup_verified", metadata: { auto_approved: true, license_status: "verified" } }, none))
      .toBe("فُعّل تلقائيًا · الترخيص مطابق لسجل الوزارة");
    expect(auditDetail({ action: "signup_verified", metadata: { auto_approved: false, license_status: "not_found" } }, none))
      .toBe("بانتظار موافقة الإدارة · الترخيص غير موجود في السجل");
  });

  it("never shows the IP kept with a deletion request", () => {
    expect(auditDetail({ action: "delete_requested", metadata: { ip: "1.2.3.4" } }, none)).not.toContain("1.2.3.4");
  });

  it("describes an admin's changes field by field", () => {
    expect(
      auditDetail({ action: "admin_doctor_updated", metadata: { is_active: false, career_stage: null, featured: "doctor" } }, none),
    ).toBe("عُلّق الحساب · المرحلة: طب عام · عُرض في «طبيب نفتخر به»");
  });

  it("names institutions, looking up an id when that is all the entry kept", () => {
    expect(auditDetail({ action: "institution_created", metadata: { name_ar: "هداسا", linked: 2 } }, none))
      .toBe("«هداسا» · أماكن عمل مربوطة: 2");
    expect(
      auditDetail({ action: "institution_updated", metadata: { id: "i1", aliases: ["مقاصد"], linked: 1 } }, () => "المقاصد"),
    ).toBe("«المقاصد» · طرق الكتابة: مقاصد · أماكن عمل أُعيد ربطها: 1");
  });

  it("shows Jerusalem time", () => {
    expect(auditTime("2026-10-19T08:53:17Z")).toBe("19/10/2026 11:53");
  });
});

describe("audit entry details", () => {
  it("labels every stored field in Arabic and hides the IP", async () => {
    const { auditFields } = await import("./auditText");
    const fields = auditFields(
      { action: "delete_requested", metadata: { ip: "1.2.3.4", auto_approved: false, license_status: "soft_match", aliases: ["أ", "ب"], duration_ms: 41000, id: "i1" } },
      (id) => (id === "i1" ? "المقاصد" : undefined),
    );
    expect(fields).toEqual([
      { label: "موافقة تلقائية", value: "لا" },
      { label: "نتيجة التحقق من الترخيص", value: "تطابق تقريبي مع السجل" },
      { label: "طرق الكتابة", value: "أ، ب" },
      { label: "المدة", value: "41 ثانية" },
      { label: "المؤسسة", value: "المقاصد", ltr: false },
    ]);
  });

  it("shows seconds in the full time", async () => {
    const { auditTimeFull } = await import("./auditText");
    expect(auditTimeFull("2026-10-19T08:53:17Z")).toBe("19/10/2026 11:53:17");
  });
});
