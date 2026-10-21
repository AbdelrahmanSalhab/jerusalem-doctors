// Signs the smoke run in once, through the real /login/dev form, and saves
// the session for production.spec.ts. /login/dev allows 5 sign-ins per
// address per 15 minutes, and every production deploy runs the smoke check:
// signing in per test used two, so a few merges close together locked the
// next run out.

import { join } from "node:path";
import { expect, test } from "@playwright/test";

/** production.spec.ts reads it from the same path (a test file cannot
 *  import another). */
const STATE = join(__dirname, "..", ".results", "smoke-session.json");

const EMAIL = process.env.SMOKE_EMAIL ?? "";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "";
const RUN = process.env.CI_RUN_URL ?? "";

test("sign in as the smoke account", async ({ page, context, baseURL }) => {
  test.skip(!EMAIL || !PASSWORD || !RUN, "SMOKE_EMAIL, SMOKE_PASSWORD and CI_RUN_URL are required");
  // Marked as a test in the activity log (lib/ciRun.ts).
  await context.route(`${baseURL}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-ci-run": RUN } }),
  );
  await page.goto("/login/dev");
  await page.getByLabel("البريد الإلكتروني").fill(EMAIL);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page).toHaveURL(/\/dashboard|\/admin/, { timeout: 15_000 });
  await context.storageState({ path: STATE });
});
