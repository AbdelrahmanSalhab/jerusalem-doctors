// Every page, as the person who would see it, at phone and desktop width, in
// light and dark: it loads, nothing scrolls sideways, the browser reports no
// errors (fixtures.ts), and axe finds no serious accessibility problems.
// Lesser axe findings are attached to the report rather than failing.

import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { devices } from "@playwright/test";
import type { Role } from "../env";
import { expect, test } from "../fixtures";
import { seededIds, stateFile } from "../helpers";

type Who = Role | "visitor";

const PAGES: [string, Who][] = [
  ["/", "visitor"],
  ["/login", "visitor"],
  ["/login/dev", "visitor"],
  ["/signup", "visitor"],
  ["/privacy", "visitor"],
  ["/dashboard", "doctor"],
  ["/profile", "doctor"],
  ["/dashboard", "pending"],
  ["/admin", "admin"],
  ["/admin?doctor=:mariam", "admin"],
  ["/admin/stats", "admin"],
  ["/admin/institutions", "admin"],
  ["/admin/specialties", "admin"],
  ["/admin/audit", "admin"],
];

const AXE_DIR = `${__dirname}/../.results/axe`;

// The phone preset without its browser choice, which a describe cannot set.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType: _browser, ...PHONE } = devices["Pixel 7"];
const SIZES = { desktop: { viewport: { width: 1280, height: 900 } }, phone: PHONE };

const WHO: Who[] = ["visitor", "doctor", "pending", "admin"];

for (const scheme of ["light", "dark"] as const) {
  for (const [size, device] of Object.entries(SIZES)) {
    for (const who of WHO) {
      test.describe(`${size}, ${scheme}, ${who}`, () => {
        test.use({ ...device, colorScheme: scheme, storageState: who === "visitor" ? { cookies: [], origins: [] } : stateFile(who) });
        for (const [rawPath] of PAGES.filter(([, w]) => w === who)) {
          test(rawPath, async ({ page }, testInfo) => {
            const path = rawPath.replace(":mariam", seededIds().mariam);
            const res = await page.goto(path);
            expect(res?.status(), path).toBeLessThan(400);
            // Not networkidle: the Turnstile widget on /login keeps polling.
            // The page's own landmark is the signal it has rendered.
            await expect(page.getByRole("main")).toBeVisible();

            await expect(page.locator("html")).toHaveAttribute("lang", "ar");
            await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
            expect((await page.title()).trim(), `${path} has no title`).not.toBe("");

            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);

            const axe = await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
              // The account button shows an avatar initial and, for admins, a
              // count badge. axe reads those as the visible label and wants
              // them in the name ("حسابي، 1 بانتظار القبول"), which an initial
              // can never sensibly be. The same button is checked on doctor
              // pages, where there is no badge.
              .exclude(who === "admin" ? 'button[aria-haspopup="menu"]' : "#none")
              .analyze();
            const summary = axe.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              help: v.help,
              nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
              count: v.nodes.length,
            }));
            if (summary.length) {
              await testInfo.attach("axe", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
              mkdirSync(AXE_DIR, { recursive: true });
              writeFileSync(`${AXE_DIR}/${size}-${scheme}-${who}-${rawPath.replace(/\W+/g, "_")}.json`, JSON.stringify({ path, size, scheme, who, summary }));
            }
            const serious = summary.filter((v) => v.impact === "serious" || v.impact === "critical");
            expect(serious, `${path}: serious accessibility problems`).toEqual([]);
          });
        }
      });
    }
  }
}
