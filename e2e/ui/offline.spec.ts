// The installed app without a network (public/sw.js): a page that can't
// load shows the offline page, whose link loads it again once back online.

import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";

test.use({ storageState: stateFile("doctor"), serviceWorkers: "allow" });

test("no network: the offline page, then «حاول مجددًا» brings the page back", async ({ page, context }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The worker is installed and controls the page.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "لا يوجد اتصال بالإنترنت" })).toBeVisible();

  await context.setOffline(false);
  await page.getByRole("link", { name: "حاول مجددًا" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "لا يوجد اتصال بالإنترنت" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
