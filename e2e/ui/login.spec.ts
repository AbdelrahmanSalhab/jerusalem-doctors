import { expect, test } from "../fixtures";
import { ACCOUNTS, PASSWORD } from "../env";
import { flushRateLimits } from "../global-setup";

test.beforeEach(flushRateLimits);

async function signInThroughForm(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login/dev");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
}

test("a doctor signs in with email and password and lands on the directory @phone", async ({ page }) => {
  await signInThroughForm(page, ACCOUNTS.doctor, PASSWORD);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "مرحبًا د. سامر" })).toBeVisible();
});

test("a wrong password is refused and stays on the form", async ({ page }) => {
  await signInThroughForm(page, ACCOUNTS.doctor, "not-the-password");
  await expect(page).toHaveURL(/\/login\/dev/);
  await expect(page.getByRole("alert")).toBeVisible();
});

test("a closed account cannot sign in", async ({ page }) => {
  await signInThroughForm(page, ACCOUNTS.closed, PASSWORD);
  await expect(page).toHaveURL(/\/login\/dev/);
});

test("a visitor is sent to the login page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("the admin area does not exist for a doctor", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: (await import("../helpers")).stateFile("doctor") });
  const res = await (await ctx.newPage()).goto("/admin");
  expect(res?.status()).toBe(404);
  await ctx.close();
});

test("the code page helps from the first second, and says nothing about whether the number has an account @phone", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => sessionStorage.setItem("verify:phone", "+972501234567"));
  await page.goto("/verify?mode=login");
  const help = page.locator("div").filter({ has: page.getByText("لم يصلك الرمز؟", { exact: true }) }).last();
  await expect(help).toBeVisible();
  await expect(help).toContainText("+972501234567");
  await expect(help).toContainText("استخدم الرقم نفسه الذي سجّلت به");
  // The same words for every number: nothing says "not registered".
  await expect(page.getByText("نرسل الرمز فقط إلى رقم مسجّل لدينا")).toHaveCount(0);
});
