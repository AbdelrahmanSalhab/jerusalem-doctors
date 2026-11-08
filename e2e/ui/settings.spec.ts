// The directory's two switches (/admin/settings). They are global, so each
// test puts both back to closed, and this file runs in the desktop project,
// which has one worker: nothing else is reading the directory meanwhile.

import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";
import { serviceClient } from "../seed";

const SEARCH_BOX = "ابحث عن طبيب أو تخصص";
const REVEAL = "إظهار الهاتف والبريد";
// A listed doctor's number in the seed (also read by directory.spec.ts).
const NUMBER = "0521234502";

type Switches = { search_before_review?: boolean; contacts_without_tap?: boolean };

/** Straight in the database; the e2e run does not cache the switches. */
async function setSwitches(values: Switches) {
  const { error } = await serviceClient().from("site_settings").update(values).eq("id", true);
  expect(error).toBeNull();
}
const closeAll = () => setSwitches({ search_before_review: false, contacts_without_tap: false });
const stored = async () =>
  (await serviceClient().from("site_settings").select("search_before_review, contacts_without_tap").single()).data;

test.afterEach(closeAll);

test.describe("as an admin", () => {
  test.use({ storageState: stateFile("admin") });

  test("both switches start closed, each says what it gives up, and opening one asks first", async ({ page }) => {
    await closeAll();
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { level: 1, name: "إعدادات الدليل" })).toBeVisible();
    const search = page.getByRole("switch", { name: "البحث قبل قبول الحساب" });
    const contacts = page.getByRole("switch", { name: "إظهار الهاتف والبريد مباشرة" });
    await expect(search).toHaveAttribute("aria-checked", "false");
    await expect(contacts).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("heading", { name: "ما تتنازل عنه" })).toHaveCount(2);
    await expect(page.getByText(/ولن يصلك تنبيه على إظهار الأرقام/)).toBeVisible();

    // A tap shows the question; nothing is saved until it is answered.
    await search.click();
    const ask = page.getByRole("group", { name: "تأكيد فتح البحث قبل قبول الحساب" });
    await expect(ask).toBeVisible();
    expect(await stored()).toEqual({ search_before_review: false, contacts_without_tap: false });
    await ask.getByRole("button", { name: "إلغاء" }).click();
    await expect(ask).toHaveCount(0);

    await search.click();
    await ask.getByRole("button", { name: "نعم، افتحه" }).click();
    await expect(page.getByText(/فُتح المفتاح/)).toBeVisible();
    await expect(search).toHaveAttribute("aria-checked", "true");
    expect(await stored()).toEqual({ search_before_review: true, contacts_without_tap: false });

    // Closing is one tap, and both changes are in the activity log with who made them.
    await search.click();
    await expect(search).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("أُعيد إغلاق المفتاح.")).toBeVisible();
    expect(await stored()).toEqual({ search_before_review: false, contacts_without_tap: false });
    const log = await serviceClient()
      .from("audit_logs")
      .select("actor_doctor_id, metadata")
      .eq("action", "directory_setting_changed")
      .order("created_at", { ascending: false })
      .limit(2);
    expect(log.data?.map((r) => r.metadata)).toEqual([
      { setting: "search_before_review", enabled: false },
      { setting: "search_before_review", enabled: true },
    ]);
    expect(log.data?.every((r) => r.actor_doctor_id)).toBe(true);

    await page.goto("/admin/audit?action=directory_setting_changed");
    await expect(page.getByText("«البحث قبل قبول الحساب»: فُتح").first()).toBeVisible();
  });

  test("a switch opened in another tab shows as open here", async ({ page }) => {
    await setSwitches({ contacts_without_tap: true });
    await page.goto("/admin/settings");
    await expect(page.getByRole("switch", { name: "إظهار الهاتف والبريد مباشرة" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "البحث قبل قبول الحساب" })).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("search before review", () => {
  test.use({ storageState: stateFile("pending") });

  test("a doctor in review searches once it is open, is told they are in review, and is shut out again when it closes", async ({ page }) => {
    await closeAll();
    await page.goto("/dashboard");
    await expect(page.getByPlaceholder(SEARCH_BOX)).toHaveCount(0);
    expect((await page.request.get("/api/search?q=ليلى")).status()).toBe(403);

    await setSwitches({ search_before_review: true });
    await page.goto("/dashboard");
    await expect(page.getByText("طلبك قيد المراجعة.")).toBeVisible();
    await page.getByPlaceholder(SEARCH_BOX).fill("ليلى");
    await expect(page.getByText("ليلى الخطيب").first()).toBeVisible();
    // Their number still waits behind the tap.
    await expect(page.getByRole("button", { name: REVEAL }).first()).toBeVisible();
    expect((await page.request.get("/api/search?q=ليلى")).status()).toBe(200);

    await closeAll();
    expect((await page.request.get("/api/search?q=ليلى")).status()).toBe(403);
  });

  test("with both open, the numbers still wait behind the tap for an account in review", async ({ page }) => {
    await setSwitches({ search_before_review: true, contacts_without_tap: true });
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/search")) bodies.push(await r.text());
    });
    await page.goto("/dashboard");
    await page.getByPlaceholder(SEARCH_BOX).fill("ليلى");
    await expect(page.getByRole("button", { name: REVEAL }).first()).toBeVisible();
    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    expect(bodies.join("\n") + (await page.content())).not.toContain(NUMBER);
  });
});

test.describe("contacts without a tap", () => {
  test.use({ storageState: stateFile("doctor") });

  test("an accepted doctor sees the number on the card, in search and on the dashboard sections", async ({ page }) => {
    await setSwitches({ contacts_without_tap: true });
    await page.goto("/dashboard");
    // The featured and new-this-week cards, read once for the viewer.
    await expect(page.getByRole("button", { name: REVEAL })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "اتصال" }).first()).toBeVisible();

    await page.getByPlaceholder(SEARCH_BOX).fill("ليلى");
    await expect(page.getByText("ليلى الخطيب").first()).toBeVisible();
    await expect(page.getByRole("button", { name: REVEAL })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "اتصال" }).first()).toHaveAttribute("href", `tel:${NUMBER}`);
  });

  test("closed again, the cards ask for the tap and carry no number", async ({ page }) => {
    await setSwitches({ contacts_without_tap: true });
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "اتصال" }).first()).toBeVisible();
    await closeAll();
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/search")) bodies.push(await r.text());
    });
    await page.goto("/dashboard");
    await page.getByPlaceholder(SEARCH_BOX).fill("ليلى");
    await expect(page.getByRole("button", { name: REVEAL }).first()).toBeVisible();
    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    expect(bodies.join("\n") + (await page.content())).not.toContain(NUMBER);
  });
});
