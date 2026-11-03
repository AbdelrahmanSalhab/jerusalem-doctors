// A super admin resets another admin's authenticator from the doctor panel
// (#164): the button asks twice, the reset is on the audit trail, and the
// admin gets an hour to enrol a new one. The shared admin account is the
// super admin here (SUPER_ADMIN_EMAILS in e2e/env.ts); a throwaway admin is
// the one who lost a phone.

import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";
import { createDoctor, serviceClient } from "../seed";

test.use({ storageState: stateFile("admin") });

test("a super admin resets another admin's authenticator", async ({ page }) => {
  const lost = await createDoctor({ first: "مسؤول", family: "فقد هاتفه", loginEmail: "lostphone@e2e.test", admin: true, visible: false });
  const db = serviceClient();
  try {
    await page.goto(`/admin?doctor=${lost.id}`);
    await page.getByRole("button", { name: "إعادة تعيين التحقق بخطوتين" }).click();
    await page.getByRole("button", { name: "نعم، أزِل التحقق بخطوتين" }).click();
    await expect(page.getByRole("status").filter({ hasText: "أُزيل تطبيق المصادقة" })).toBeVisible();

    const { data: logged } = await db.from("audit_logs").select("metadata").eq("action", "admin_mfa_reset").eq("target_doctor_id", lost.id);
    expect(logged).toHaveLength(1);
    const { data: row } = await db.from("doctors").select("auth_user_id").eq("id", lost.id).single();
    const user = (await db.auth.admin.getUserById(row!.auth_user_id!)).data.user;
    expect(user?.app_metadata.mfa_enrol_until).toBeGreaterThan(Date.now());
  } finally {
    await db.from("audit_logs").delete().eq("target_doctor_id", lost.id);
    await lost.remove();
  }
});

test("a doctor who is not an admin has no reset to offer", async ({ page }) => {
  const doctor = await createDoctor({ first: "طبيب", family: "عادي" });
  try {
    await page.goto(`/admin?doctor=${doctor.id}`);
    await expect(page.getByText("التحقق من الترخيص")).toBeVisible();
    await expect(page.getByRole("button", { name: "إعادة تعيين التحقق بخطوتين" })).toHaveCount(0);
  } finally {
    await doctor.remove();
  }
});
