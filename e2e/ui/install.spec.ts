// Adding the directory to the home screen (components/install): the
// dashboard's invitation on phones, the instructions where no native prompt
// exists, and Chrome's native prompt where it does (a dispatched
// beforeinstallprompt: the real dialog can only be seen on a real phone).

import { devices, type Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { BASE_URL } from "../env";
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

const invite = (page: Page) => page.getByRole("region", { name: "أضف الدليل إلى هاتفك" });

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

  test("«لاحقًا» closes it even where the browser refuses storage @phone", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new Error("blocked");
      };
    });
    await page.goto("/dashboard");
    await invite(page).getByRole("button", { name: "لاحقًا" }).click();
    await expect(invite(page)).toBeHidden();
    // Still closed a moment later: nothing brings it back.
    await page.waitForTimeout(300);
    await expect(invite(page)).toBeHidden();
  });
});

test.describe("on Android, once Chrome offers to install", () => {
  test.use(ANDROID);

  test("«تثبيت» opens the native prompt once; cancelling it counts as «لاحقًا»", async ({ page }) => {
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
        event.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(event);
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto("/dashboard");
    await invite(page).getByRole("button", { name: "تثبيت" }).click();
    await expect(invite(page)).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("install:snoozes"))).toBe("1");
  });

  test("Chrome's own install bar is held back only while the site still offers its own", async ({ page, browser }) => {
    const offer = (p: Page) =>
      p.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    await page.goto("/dashboard");
    expect(await offer(page)).toBe(true);

    // Put off three times: the site stops asking, so Chrome may.
    await page.evaluate(() => localStorage.setItem("install:snoozes", "3"));
    expect(await offer(page)).toBe(false);

    // A visitor who isn't signed in keeps Chrome's.
    const visitor = await browser.newPage({ ...ANDROID, baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    await visitor.goto("/login");
    expect(await offer(visitor)).toBe(false);
    await visitor.close();
  });
});

test("on a computer: no invitation, and the menu gives the instructions", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
  await page.getByRole("button", { name: /^حسابي/ }).click();
  await page.getByRole("menuitem", { name: "أضف الدليل إلى جهازي" }).click();
  await expect(page.getByRole("dialog", { name: "أضف الدليل إلى جهازك" })).toBeVisible();
  // Closing it puts the keyboard back on the account button, not the page.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^حسابي/ })).toBeFocused();
});

