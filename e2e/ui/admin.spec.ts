import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";
import { createDoctor, serviceClient } from "../seed";

test.use({ storageState: stateFile("admin") });

test("the tiles count doctors, not the hidden admin account", async ({ page }) => {
  await page.goto("/admin");
  // Seeded: one doctor waiting (منتظر القبول), one hidden (خفي المخفي); the
  // hidden non-doctor admin is in neither.
  await expect(page.getByRole("link", { name: /بانتظار القبول\s*1$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /مخفي من الدليل\s*1$/ })).toBeVisible();
});

test.describe("accepting a doctor", () => {
  let waiting: Awaited<ReturnType<typeof createDoctor>>;
  test.beforeEach(async () => {
    waiting = await createDoctor({ first: "طالب", family: "القبول", approved: false });
  });
  test.afterEach(async () => waiting.remove());

  test("an admin accepts a waiting doctor, who then appears in the directory", async ({ page, browser }) => {
    await page.goto("/admin?status=pending&q=طالب");
    // The search leaves this doctor alone on screen.
    await expect(page.getByText("طالب القبول")).toBeVisible();
    await page.getByRole("button", { name: "قبول العضوية" }).click();
    await expect(page.getByText("حُفظ التغيير.")).toBeVisible();
    await expect
      .poll(async () => (await serviceClient().from("doctors").select("is_admin_approved").eq("id", waiting.id).single()).data?.is_admin_approved)
      .toBe(true);

    const doctor = await browser.newContext({ storageState: stateFile("doctor") });
    const p = await doctor.newPage();
    await p.goto("/dashboard");
    await p.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("طالب");
    await expect(p.getByText("طالب القبول").first()).toBeVisible();
    await doctor.close();
  });
});

test("the panel opens from the activity log", async ({ page }) => {
  await page.goto("/admin/audit");
  // An entry opens on click; the first one about a doctor has the link.
  // Collapsed content is hidden from role queries, so this one is by markup.
  const entry = page.locator("details:has(a[href^='/admin?doctor='])").first();
  await entry.locator(":scope > summary").click();
  await entry.getByRole("link", { name: "فتح الطبيب في قائمة الأطباء" }).click();
  await expect(page).toHaveURL(/\/admin\?doctor=/);
  await expect(page.getByText("التحقق من الترخيص")).toBeVisible();
});
