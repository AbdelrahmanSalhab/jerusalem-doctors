// The home page for visitors: searching asks them to sign up or sign in.

import { expect, test } from "../fixtures";

test("a visitor's search opens the sign-up box @phone", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("dialog", { name: "البحث متاح للأطباء المسجّلين فقط" });
  await expect(box).toBeHidden();

  await page.getByRole("searchbox", { name: "بحث" }).click();
  await expect(box).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();

  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(box).toBeVisible();
  await box.getByRole("link", { name: "إنشاء حساب" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});
