import { expect, test } from "../fixtures";
import { seededIds, stateFile } from "../helpers";
import { serviceClient } from "../seed";

test.use({ storageState: stateFile("admin") });

test.afterAll(async () => {
  await serviceClient().from("doctors").update({ is_admin_approved: false }).eq("id", seededIds().pending);
});

test("the tiles count doctors, not the hidden admin account", async ({ page }) => {
  await page.goto("/admin");
  const tile = (label: string) => page.locator("a, div").filter({ hasText: new RegExp(`^${label}\\s*\\d+$`) }).first();
  await expect(tile("بانتظار القبول")).toContainText("1");
  await expect(tile("مخفي من الدليل")).toContainText("1");
});

test("an admin accepts a waiting doctor, who then appears in the directory", async ({ page, browser }) => {
  await page.goto("/admin?status=pending");
  const row = page.locator("li, tr, div").filter({ hasText: "منتظر القبول" }).filter({ has: page.getByRole("button", { name: "قبول العضوية" }) }).last();
  await row.getByRole("button", { name: "قبول العضوية" }).click();
  await expect(page.getByText("حُفظ التغيير.")).toBeVisible();

  const { data } = await serviceClient().from("doctors").select("is_admin_approved").eq("id", seededIds().pending).single();
  expect(data!.is_admin_approved).toBe(true);

  const doctor = await browser.newContext({ storageState: stateFile("doctor") });
  const p = await doctor.newPage();
  await p.goto("/dashboard");
  await p.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("منتظر");
  await expect(p.getByText("منتظر القبول").first()).toBeVisible();
  await doctor.close();
});

test("the panel opens from the activity log", async ({ page }) => {
  await page.goto("/admin/audit");
  const link = page.getByRole("link", { name: "فتح الطبيب في قائمة الأطباء" }).first();
  // Entries open on click; the link sits inside.
  await page.locator("details > summary").first().click();
  await link.click();
  await expect(page).toHaveURL(/\/admin\?doctor=/);
  await expect(page.getByText("التحقق من الترخيص")).toBeVisible();
});
