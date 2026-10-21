// What a person notices: their choices stick, the keyboard works, and the
// directory follows the rules the product promises.

import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";
import { createDoctor, serviceClient } from "../seed";

test.describe("as a doctor", () => {
  test.use({ storageState: stateFile("doctor") });

  test("a theme choice survives a reload, applied before the page paints @phone", async ({ page }) => {
    await page.goto("/dashboard");
    const toggle = page.getByRole("button", { name: /^المظهر:/ });
    for (let i = 0; i < 3 && !(await toggle.getAttribute("aria-label"))?.includes("داكن"); i++) await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Read at DOMContentLoaded: the boot script sets it before React runs,
    // so there is no light flash.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("the specialty filter works from the keyboard", async ({ page }) => {
    await page.goto("/dashboard");
    const button = page.getByRole("button", { name: /كل التخصصات/ });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test.describe("featured graduates", () => {
    let grad: Awaited<ReturnType<typeof createDoctor>>;
    test.beforeEach(async () => {
      grad = await createDoctor({ first: "خريج", family: "مميز", stage: null, specialties: ["الطب العام"], featured: "graduate", seekingWork: true });
    });
    test.afterEach(async () => grad.remove());

    test("show only while the graduate is still looking for work", async ({ page }) => {
      await page.goto("/dashboard");
      // The featured section only: as a new doctor he is also in «جديد هذا الأسبوع».
      const featured = page.getByRole("region", { name: "أطباء مميزون يبحثون عن عمل" });
      await expect(featured.getByText("خريج مميز").first()).toBeVisible();
      await serviceClient().from("doctors").update({ seeking_work: false }).eq("id", grad.id);
      await page.reload();
      await expect(featured.getByText("خريج مميز")).toHaveCount(0);
    });
  });
});

test.describe("as a doctor waiting for approval", () => {
  test.use({ storageState: stateFile("pending") });

  test("is told the account is under review, and can already search", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("status").filter({ hasText: "حسابك قيد المراجعة" })).toBeVisible();
    await page.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("ليلى");
    await expect(page.getByText("ليلى الخطيب").first()).toBeVisible();
  });
});
