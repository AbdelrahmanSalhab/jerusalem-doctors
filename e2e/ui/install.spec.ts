// Adding the directory to the home screen (components/install): the
// dashboard's invitation on phones, the instructions where no native prompt
// exists, and Chrome's native prompt where it does (a dispatched
// beforeinstallprompt: the real dialog can only be seen on a real phone).

import { devices } from "@playwright/test";
import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";

test.use({ storageState: stateFile("doctor") });

/** A device minus its browser type, which a describe group can't change. */
function asDevice(name: string) {
  const d: Partial<(typeof devices)[string]> = { ...devices[name] };
  delete d.defaultBrowserType;
  return d;
}
const IPHONE = asDevice("iPhone 13");
const ANDROID = asDevice("Pixel 7");

const invite = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "أضف الدليل إلى هاتفك" });

test.describe("on an iPhone", () => {
  test.use(IPHONE);

  test("the dashboard invites with instructions, and «لاحقًا» keeps it away @phone", async ({ page }) => {
    await page.goto("/dashboard");
    await invite(page).getByRole("button", { name: "طريقة الإضافة" }).click();
    const help = page.getByRole("dialog", { name: "أضف الدليل إلى شاشتك الرئيسية" });
    await expect(help).toBeVisible();
    await expect(help.getByText("اختر «إضافة إلى الشاشة الرئيسية».")).toBeVisible();
    await help.getByRole("button", { name: "إغلاق" }).click();
    await expect(help).toBeHidden();

    await invite(page).getByRole("button", { name: "لاحقًا" }).click();
    await expect(invite(page)).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(invite(page)).toBeHidden();
  });
});

test.describe("on Android, once Chrome offers to install", () => {
  test.use(ANDROID);

  test("«تثبيت» opens the native prompt once, then the invitation goes", async ({ page }) => {
    // Chrome fires the event once, as soon as the page is eligible: on a
    // repeat visit that can be before React has loaded. Sent once here, as
    // the page's body starts, so the <head> script has to have kept it.
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        if (!document.body) return;
        observer.disconnect();
        const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & Record<string, unknown>;
        event.prompt = () => {
          const w = window as unknown as { prompted?: number };
          w.prompted = (w.prompted ?? 0) + 1;
          return Promise.resolve();
        };
        event.userChoice = Promise.resolve({ outcome: "accepted" });
        window.dispatchEvent(event);
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto("/dashboard");
    await invite(page).getByRole("button", { name: "تثبيت" }).click();
    await expect(invite(page)).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
  });
});

test("on a computer: no invitation, and the menu gives the instructions", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
  await page.getByRole("button", { name: /^حسابي/ }).click();
  await page.getByRole("menuitem", { name: "أضف الدليل إلى جهازي" }).click();
  await expect(page.getByRole("dialog", { name: "أضف الدليل إلى جهازك" })).toBeVisible();
});
