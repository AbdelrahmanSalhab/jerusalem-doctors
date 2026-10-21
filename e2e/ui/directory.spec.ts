import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";
import { createDoctor, LISTED, NEVER_LISTED, serviceClient } from "../seed";

test.use({ storageState: stateFile("doctor") });

async function search(page: Page, q: string) {
  await page.goto("/dashboard");
  await page.getByPlaceholder("ابحث عن طبيب أو تخصص").fill(q);
}

test("the dashboard counts the listed doctors and shows the featured ones @phone", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText(`${LISTED.length} أطباء`)).toBeVisible();
  await expect(page.getByText("ليلى الخطيب").first()).toBeVisible();
});

test("search finds by name and never shows hidden, pending or admin rows", async ({ page }) => {
  await search(page, "ليلى");
  await expect(page.getByText("ليلى الخطيب").first()).toBeVisible();
  // A query every seeded name contains a letter of.
  for (const q of ["ا", "ل"]) {
    // Wait for this query's response, set up before typing so it cannot be missed.
    const answered = page.waitForResponse((r) => r.url().includes("/api/search") && r.url().includes(encodeURIComponent(q)));
    await search(page, q);
    await answered;
    const body = await page.locator("main").innerText();
    for (const name of NEVER_LISTED) expect(body, `query ${q}`).not.toContain(name);
  }
});

test("a specialty search includes its subspecialties", async ({ page }) => {
  // سامر is a cardiologist; القلب sits under الباطنية.
  await search(page, "الباطنية");
  await expect(page.getByText("سامر ناصر").first()).toBeVisible();
});

test("the specialty filter narrows the list @phone", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /كل التخصصات/ }).click();
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  // The whole list fits the screen (the iPhone cut-off bug).
  const box = await list.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
  await list.getByRole("option", { name: /^الأطفال/ }).click();
  await expect(page.getByText("مريم عودة").first()).toBeVisible();
  await expect(page.getByText("ليلى الخطيب").first()).toBeVisible();
  await expect(page.getByText("يوسف حداد")).toHaveCount(0);
});

test.describe("new this week", () => {
  const made: Awaited<ReturnType<typeof createDoctor>>[] = [];
  test.beforeAll(async () => {
    // سامر (the signed-in doctor) is a cardiologist: القلب sits under الباطنية.
    made.push(await createDoctor({ first: "جديد", family: "أطفال", specialties: ["الأطفال"] }));
    made.push(await createDoctor({ first: "جديد", family: "باطنية", specialties: ["الباطنية"] }));
  });
  test.afterAll(async () => {
    for (const d of made) await d.remove();
  });

  test("lists colleagues who joined this week, my specialty area first, never me @phone", async ({ page }) => {
    await page.goto("/dashboard");
    const section = page.getByRole("region", { name: "جديد هذا الأسبوع" });
    await expect(section).toBeVisible();
    await expect(section.getByRole("listitem").first()).toContainText("جديد باطنية");
    await expect(section.getByText("جديد أطفال").first()).toBeVisible();
    await expect(section.getByText("سامر ناصر")).toHaveCount(0);
  });
});

test("the filter panel narrows by career stage and looking for work, with no text @phone", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^تصفية/ }).click();
  await page.getByLabel("المرحلة المهنية").selectOption({ label: "طبيب مقيم" });
  await expect(page.getByText("مريم عودة").first()).toBeVisible();
  await expect(page.getByText("سامر ناصر")).toHaveCount(0);

  await page.getByLabel("المرحلة المهنية").selectOption({ label: "الكل" });
  await page.getByLabel("يبحث عن فرصة عمل").check();
  await expect(page.getByText("يوسف حداد").first()).toBeVisible();
  await expect(page.getByText("مريم عودة")).toHaveCount(0);

  await page.getByRole("button", { name: "مسح التصفية" }).click();
  await expect(page.getByText(/في الدليل/)).toBeVisible();
});

test("saving a contact gives name and numbers, never the licence", async ({ page }) => {
  await search(page, "ليلى");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /إضافة لجهات الاتصال/ }).first().click(),
  ]);
  const vcard = readFileSync((await download.path())!, "utf8");
  expect(vcard).toContain("FN;CHARSET=UTF-8:د. ليلى الخطيب");
  expect(vcard).toContain("TEL;TYPE=CELL:+972521234502");
  expect(vcard).not.toContain("510001");
  expect(vcard).not.toContain("ترخيص");
});

test("WhatsApp opens with the viewer's introduction, and the press is counted", async ({ page }) => {
  const db = serviceClient();
  const before = (await db.from("usage_events").select("*", { count: "exact", head: true })).count ?? 0;
  await search(page, "ليلى");
  const wa = page.getByRole("link", { name: "واتساب" }).first();
  const href = (await wa.getAttribute("href"))!;
  expect(href).toMatch(/^https:\/\/wa\.me\/972521234502\?text=/);
  expect(decodeURIComponent(href)).toContain("سامر");
  await page.context().route("https://wa.me/**", (r) => r.abort());
  await wa.click();
  await expect
    .poll(async () => (await db.from("usage_events").select("*", { count: "exact", head: true })).count ?? 0)
    .toBeGreaterThan(before);
});

test("no search response carries a licence number or another doctor's private fields", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (r.url().includes("/api/search")) bodies.push(await r.text());
  });
  await search(page, "ا");
  await expect.poll(() => bodies.length).toBeGreaterThan(0);
  const all = bodies.join("\n") + (await page.content());
  for (const secret of ["510001", "510002", "510003", "510004", "license_number", "auth_user_id", "is_admin"]) {
    expect(all, secret).not.toContain(secret);
  }
});
