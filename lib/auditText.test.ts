import { describe, expect, it } from "vitest";
import { auditDetail, auditFields, auditTime, auditTitle } from "./auditText";

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
    ).toBe("أُغلق الحساب · المرحلة: طب عام · عُرض في «طبيب نفتخر به»");
  });

  // Closing an account and withdrawing membership used to read as the same
  // word in the log, the same confusion the three switches on /admin fix.
  it("tells withdrawing membership apart from closing the account", () => {
    const approval = auditDetail({ action: "admin_doctor_updated", metadata: { is_admin_approved: false } }, none);
    const account = auditDetail({ action: "admin_doctor_updated", metadata: { is_active: false } }, none);
    expect(approval).toBe("سُحب قبول العضوية");
    expect(account).toBe("أُغلق الحساب");
    expect(approval).not.toBe(account);
  });

  it("keeps the reason an admin gave for accepting an unverified licence", () => {
    expect(
      auditDetail(
        { action: "admin_doctor_updated", metadata: { is_admin_approved: true, approval_reason: "راجعت صورة الشهادة" } },
        none,
      ),
    ).toBe("قُبلت العضوية · السبب: «راجعت صورة الشهادة»");
  });

  describe("licence re-checks", () => {
    it("reads a corrected number as before and after", () => {
      expect(
        auditDetail(
          {
            action: "admin_license_corrected",
            metadata: {
              slot: "primary",
              license_number_before: "1189371",
              license_number_after: "189371",
              license_status_before: "not_found",
              license_status_after: "verified",
            },
          },
          none,
        ),
      ).toBe("الرقم: «1189371» ← «189371» · الترخيص غير موجود في السجل ← الترخيص مطابق لسجل الوزارة");
    });

    it("reads a re-check of the same number as a status change", () => {
      expect(
        auditDetail(
          {
            action: "admin_license_rechecked",
            metadata: { slot: "primary", license_number: "189371", license_status_before: null, license_status_after: "verified" },
          },
          none,
        ),
      ).toBe("الرقم: «189371» · لم تُسجَّل نتيجة تحقق ← الترخيص مطابق لسجل الوزارة");
    });

    it("names the secondary slot and keeps an override reason", () => {
      const detail = auditDetail(
        {
          action: "admin_license_corrected",
          metadata: { slot: "secondary", license_number: "55", license_status_after: "name_mismatch_overridden", reason: "تحققت هاتفيًا" },
        },
        none,
      );
      expect(detail).toContain("الترخيص الإضافي");
      expect(detail).toContain("السبب: «تحققت هاتفيًا»");
    });

    it("renders both actions with an Arabic title, never the raw code", () => {
      for (const action of ["admin_license_rechecked", "admin_license_corrected"]) {
        expect(auditTitle(action)).not.toBe(action);
        expect(auditTitle(action)).toMatch(/[\u0600-\u06FF]/);
      }
    });

    it("labels the new metadata keys instead of showing raw keys", () => {
      const fields = auditFields(
        {
          action: "admin_license_corrected",
          metadata: { license_status_after: "soft_match", match_first: "edit1", source: "mirror" },
        },
        none,
      );
      expect(fields).toEqual([
        { label: "الحالة بعد", value: "تطابق تقريبي مع السجل" },
        { label: "مطابقة الاسم الأول", value: "edit1" },
        { label: "مصدر النتيجة", value: "mirror" },
      ]);
    });
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

describe("an admin editing a profile", () => {
  it("names the fields in Arabic, drops the search copies, and masks the phone", () => {
    expect(auditTitle("admin_doctor_profile_edited")).toBe("تعديل الملف من الإدارة");
    const line = auditDetail(
      {
        action: "admin_doctor_profile_edited",
        metadata: {
          fields: ["arabic_first_name", "arabic_first_name_normalized", "bio", "phone_e164", "phone_display"],
          workplaces: 2,
          hebrew_name_changed: true,
          phone_changed: true,
          phone_before: "+9725…1122",
          phone_after: "+9725…3344",
          auth_sync: "updated",
        },
      },
      () => undefined,
    );
    expect(line).toContain("الاسم الأول");
    expect(line).toContain("النبذة");
    // The *_normalized twins and phone_display would read as duplicates.
    expect(line).not.toContain("_normalized");
    expect(line).not.toContain("صيغة عرض الهاتف");
    expect(line).toContain("أماكن العمل: 2");
    expect(line).toContain("«+9725…1122» ← «+9725…3344»");
    expect(line).toContain("نُقل حساب الدخول إلى الرقم الجديد");
    expect(line).toContain("يحتاج إعادة فحص الترخيص");
  });

  it("says which way the photo went", () => {
    expect(auditTitle("admin_doctor_photo_changed")).toBe("تغيير الصورة من الإدارة");
    const removed = auditDetail({ action: "admin_doctor_photo_changed", metadata: { removed: true } }, () => undefined);
    expect(removed).toBe("حُذفت الصورة الشخصية");
    const added = auditDetail({ action: "admin_doctor_photo_changed", metadata: { removed: false } }, () => undefined);
    expect(added).toBe("رُفعت صورة شخصية جديدة");
  });
});
