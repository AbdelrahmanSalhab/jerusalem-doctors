// The admin's working tools: licence correction against the registry,
// institutions, and paging through the activity log.

import { expect, test } from "../fixtures";
import { seededIds, stateFile } from "../helpers";
import { serviceClient } from "../seed";

test.use({ storageState: stateFile("admin") });

test.describe("licence correction", () => {
  test.afterAll(async () => {
    await serviceClient()
      .from("doctors")
      .update({ license_number: "510004", license_verification_status: "not_found" })
      .eq("id", seededIds().mariam);
  });

  test("an admin finds the right number in the registry and saves it", async ({ page }) => {
    // مريم was stored with 510004, which the registry does not have.
    await page.goto(`/admin?doctor=${seededIds().mariam}`);
    await page.getByRole("button", { name: "بحث في السجل أو تصحيح الرقم" }).first().click();
    await page.locator("#lic-primary").fill("510030");
    await page.getByRole("button", { name: "بحث في السجل", exact: true }).click();
    await expect(page.getByText("نتيجة البحث")).toBeVisible();
    await page.getByRole("button", { name: "حفظ هذا الرقم" }).click();
    await expect
      .poll(async () => (await serviceClient().from("doctors").select("license_number, license_verification_status").eq("id", seededIds().mariam).single()).data)
      .toEqual({ license_number: "510030", license_verification_status: "verified" });
    const { data: audit } = await serviceClient().from("audit_logs").select("action").eq("target_doctor_id", seededIds().mariam).order("created_at", { ascending: false }).limit(1);
    expect(audit![0].action).toBe("admin_license_corrected");
  });
});

test("an admin adds an institution and removes it", async ({ page }) => {
  await page.goto("/admin/institutions");
  await page.getByLabel("الاسم بالعربية").fill("مستشفى الاختبار");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.getByText("مستشفى الاختبار").first()).toBeVisible();
  const row = page.locator("li").filter({ hasText: "مستشفى الاختبار" }).first();
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "حذف" }).click();
  await expect(page.getByText("حُذفت «مستشفى الاختبار»", { exact: false })).toBeVisible();
  const { data } = await serviceClient().from("institutions").select("id").eq("name_ar", "مستشفى الاختبار");
  expect(data).toEqual([]);
});

test.describe("activity log", () => {
  test.beforeAll(async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      action: "admin_doctor_updated",
      actor_doctor_id: seededIds().admin,
      target_doctor_id: seededIds().laila,
      metadata: { is_visible: true, n: i },
      created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    await serviceClient().from("audit_logs").insert(rows);
  });
  test.afterAll(async () => {
    await serviceClient().from("audit_logs").delete().eq("action", "admin_doctor_updated").lt("created_at", "2026-01-02");
  });

  test("pages through every entry", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(page.getByText(/الصفحة 1 من [2-9]/)).toBeVisible();
    await page.getByRole("link", { name: "التالي" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/الصفحة 2 من/)).toBeVisible();
    await page.getByRole("link", { name: "السابق" }).click();
    await expect(page.getByText(/الصفحة 1 من/)).toBeVisible();
  });
});
