// What the admin panel is made of, read from the live site (production.spec.ts).
// Reads only: it opens pages and a doctor's panel and presses nothing that saves.
// Whatever the data, so no name or count is expected, only the structure.

import { expect, type Page } from "@playwright/test";

const TABS = ["الأطباء", "الطلبات", "الإعدادات", "الإحصائيات", "سجل النشاط"];

/** A page of each group, the tab that holds it and the pills under that tab. */
const GROUPS: { path: string; tab: string; pills: string[]; lit: string }[] = [
  { path: "/admin/requests", tab: "الطلبات", pills: ["طلبات الأرقام", "البلاغات"], lit: "طلبات الأرقام" },
  { path: "/admin/reports", tab: "الطلبات", pills: ["طلبات الأرقام", "البلاغات"], lit: "البلاغات" },
  { path: "/admin/institutions", tab: "الإعدادات", pills: ["المستشفيات", "التخصصات", "الدليل"], lit: "المستشفيات" },
  { path: "/admin/specialties", tab: "الإعدادات", pills: ["المستشفيات", "التخصصات", "الدليل"], lit: "التخصصات" },
  { path: "/admin/settings", tab: "الإعدادات", pills: ["المستشفيات", "التخصصات", "الدليل"], lit: "الدليل" },
  { path: "/admin/audit", tab: "سجل النشاط", pills: ["كل الأحداث", "التنبيهات", "تسجيلات لم تكتمل"], lit: "كل الأحداث" },
  { path: "/admin/audit?action=alert", tab: "سجل النشاط", pills: ["كل الأحداث", "التنبيهات", "تسجيلات لم تكتمل"], lit: "التنبيهات" },
  { path: "/admin/signups", tab: "سجل النشاط", pills: ["كل الأحداث", "التنبيهات", "تسجيلات لم تكتمل"], lit: "تسجيلات لم تكتمل" },
];

const tabsOf = (page: Page) => page.getByRole("navigation", { name: "أقسام الإدارة" });

export async function checkTabs(page: Page) {
  const r = await page.goto("/admin");
  expect(r?.status()).toBe(200);
  const names = await tabsOf(page).getByRole("link").allInnerTexts();
  expect(names.map((n) => n.replace(/\s*\(.*\)\s*$/, "").replace(/\s*\d+\s*$/, "").trim()), "the five tabs").toEqual(TABS);

  for (const g of GROUPS) {
    const res = await page.goto(g.path);
    expect(res?.status(), g.path).toBe(200);
    await expect(tabsOf(page).getByRole("link", { name: new RegExp(g.tab) }), `${g.path}: its tab is open`).toHaveAttribute("aria-current", "true");
    const pills = page.getByRole("navigation", { name: new RegExp(`${g.tab}: صفحات القسم`) });
    for (const p of g.pills) await expect(pills.getByRole("link", { name: new RegExp(p) }), `${g.path}: pill ${p}`).toBeVisible();
    // One pill lit, and the right one.
    await expect(pills.locator('[aria-current="page"]'), g.path).toHaveCount(1);
    await expect(pills.getByRole("link", { name: new RegExp(g.lit) }), g.path).toHaveAttribute("aria-current", "page");
  }
}

export async function checkDoctorsPage(page: Page) {
  await page.goto("/admin");
  const bar = page.getByRole("navigation", { name: "تصنيفات الأطباء" });
  await expect(bar.getByRole("link", { name: /كل الحسابات/ })).toHaveAttribute("aria-current", "page");
  // The review queues are always there, counts or not.
  for (const q of ["بانتظار القبول", "ترخيص يحتاج مراجعة", "لم تُراجَع هويته"]) await expect(bar.getByRole("link", { name: new RegExp(q) })).toBeVisible();
  // The tiles this replaced.
  await expect(page.getByText("منها", { exact: false }).locator("xpath=self::a")).toHaveCount(0);

  // A row opens the panel (a read: it is a link in the address). A doctor waiting to
  // be let in has the button for it on the row; with none waiting, the first row will do.
  const rows = page.locator("main button[aria-expanded]");
  const n = await rows.count();
  expect(n, "the list has doctors").toBeGreaterThan(0);
  const review = page.getByRole("button", { name: "مراجعة وقبول" }).first();
  const waiting = (await review.count()) > 0;
  await (waiting ? review : rows.first()).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/[?&]doctor=/);
  await expect(panel.getByText("التحقق من الترخيص")).toBeVisible();
  const bottom = panel.locator(".sticky.bottom-0");
  if (waiting) {
    await expect(bottom.getByRole("button", { name: "قبول العضوية" }), "the accept bar of a waiting doctor").toBeVisible();
    // The record before the switches.
    const order = await panel.evaluate((el) => {
      const at = (t: string) => (el.textContent ?? "").indexOf(t);
      return [at("التحقق من الترخيص"), at("المرحلة المهنية")];
    });
    expect(order[0]).toBeLessThan(order[1]);
  } else {
    await expect(bottom.getByRole("button", { name: "قبول العضوية" }), "no accept bar with nobody waiting").toHaveCount(0);
  }
  // With more than one doctor in the list there is somewhere to step to, whichever row this is.
  if (n > 1) expect(await panel.getByRole("link", { name: /^(التالي|السابق)$/ }).count(), "a doctor to step to").toBeGreaterThan(0);
  await expect(panel.getByText(/^\d+ من \d+$/), "which doctor of how many").toBeVisible();
  // Danger zone last.
  await expect(panel.getByText("الحذف النهائي").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
}

export async function checkStatsLinks(page: Page) {
  const r = await page.goto("/admin/stats");
  expect(r?.status()).toBe(200);
  const hrefs = await page.getByRole("navigation", { name: "أقسام الصفحة" }).getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  expect(hrefs.length, "jump links").toBeGreaterThan(7);
  for (const h of hrefs) await expect(page.locator(h), `${h} has its section`).toHaveCount(1);
}

/** On a phone: five tabs fit without scrolling, and what is tapped is 44 px tall. */
/** The directory's switches: both listed, each with the words that say what it gives up. Presses nothing. */
export async function checkSettings(page: Page) {
  const r = await page.goto("/admin/settings");
  expect(r?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "إعدادات الدليل" })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "ما تتنازل عنه" })).toHaveCount(2);
}

export async function checkPhone(page: Page) {
  await page.goto("/admin");
  const row = await tabsOf(page).evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }));
  expect(row.sw, "the tab row scrolls sideways").toBeLessThanOrEqual(row.cw + 1);
  const heights = await page.locator('nav[aria-label] a').evaluateAll((as) => as.map((a) => Math.round(a.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(5);
  expect(Math.min(...heights), "a link under 44 px").toBeGreaterThanOrEqual(44);
}
