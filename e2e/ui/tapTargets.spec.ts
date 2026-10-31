// On a phone every control is at least 44 px tall, the size a fingertip
// needs (WCAG 2.5.5, Apple's and Google's guidance). The site sizes them with
// Tailwind's pointer-coarse: variant, so a mouse keeps the compact layout.
// Exempt: links inside running text, and a checkbox or radio whose label is
// the target.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";

const MIN = 44;

// The sizes apply on touch screens only (pointer-coarse:); the desktop
// project runs every UI test with a mouse, where the compact layout is right.
test.skip(({ hasTouch }) => !hasTouch, "touch screens only");

/** Visible controls shorter than MIN, as "28px «label»". */
function tooSmall(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const controls =
      "button, a[href], summary, select, input:not([type=hidden]), [role=button], [role=menuitem], label:has(input[type=checkbox]), label:has(input[type=radio])";
    const out = new Set<string>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(controls))) {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!box.width || !box.height || style.visibility === "hidden") continue;
      if (el.tagName === "A" && style.display === "inline") continue;
      if (el.tagName === "INPUT" && el.closest("label")) continue;
      if (box.height < min) {
        const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || el.tagName).trim();
        out.add(`${Math.round(box.height)}px «${name.replace(/\s+/g, " ").slice(0, 40)}»`);
      }
    }
    return [...out];
  }, MIN);
}

test.describe("signed in @phone", () => {
  test.use({ storageState: stateFile("doctor") });

  test("the dashboard, with results, and the profile", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await tooSmall(page), "/dashboard").toEqual([]);

    await page.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("د");
    await expect(page.getByRole("button", { name: "+ إضافة لجهات الاتصال" }).first()).toBeVisible();
    expect(await tooSmall(page), "/dashboard with results").toEqual([]);

    await page.goto("/profile");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await tooSmall(page), "/profile").toEqual([]);
  });
});

test.describe("admin @phone", () => {
  test.use({ storageState: stateFile("admin") });

  // The panel's own pages are denser (tables for a desktop); its tab bar is
  // what every admin page starts with.
  test("the admin tab bar", async ({ page }) => {
    await page.goto("/admin/stats");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const heights = await page.locator('nav[aria-label] a').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(3);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(MIN);
  });
});

test.describe("signed out @phone", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of ["/", "/login", "/signup"]) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      expect(await tooSmall(page), path).toEqual([]);
    });
  }
});
