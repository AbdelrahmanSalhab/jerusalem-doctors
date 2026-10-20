// A doctor's own account: photo upload and the deletion request.

import path from "node:path";
import { request } from "@playwright/test";
import { BASE_URL, PASSWORD, THROWAWAY_ACCOUNTS } from "../env";
import { expect, test } from "../fixtures";
import { seededIds, stateFile } from "../helpers";
import { createDoctor, serviceClient } from "../seed";

test.describe("photo", () => {
  test.use({ storageState: stateFile("doctor") });
  test.afterAll(async () => {
    await serviceClient().from("doctors").update({ profile_picture_url: null }).eq("id", seededIds().samer);
  });

  test("a real image uploads and shows; a renamed text file is refused @phone", async ({ page }) => {
    await page.goto("/profile");
    // Through the file chooser the button opens, as a person would.
    const choose = async (file: Parameters<import("@playwright/test").FileChooser["setFiles"]>[0]) => {
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: /رفع صورة|تغيير الصورة/ }).click();
      await (await chooser).setFiles(file);
    };
    await choose({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("not an image at all") });
    await expect(page.getByText(/صيغة|نوع|غير مدعوم/).first()).toBeVisible();

    await choose(path.join(__dirname, "../pixel.png"));
    await expect(page.getByRole("button", { name: "تغيير الصورة" })).toBeVisible();
    const { data } = await serviceClient().from("doctors").select("profile_picture_url").eq("id", seededIds().samer).single();
    expect(data!.profile_picture_url).toMatch(/\/storage\/v1\/object\/public\/doctor-photos\//);
    // The stored file is served back.
    expect((await page.request.get(data!.profile_picture_url!)).status()).toBe(200);
  });
});

test.describe("deletion request", () => {
  const email = THROWAWAY_ACCOUNTS[0];
  let doctor: Awaited<ReturnType<typeof createDoctor>>;
  // The request closes the account for good, so it gets its own.
  test.beforeEach(async () => {
    doctor = await createDoctor({ first: "مغادر", family: "قريبًا", loginEmail: email });
  });
  test.afterEach(async () => doctor.remove());

  test("closes the account, signs the doctor out and keeps them out", async ({ browser }) => {
    const api = await request.newContext({ baseURL: BASE_URL });
    expect((await api.post("/api/login/password", { data: { email, password: PASSWORD } })).ok()).toBe(true);
    const ctx = await browser.newContext({ storageState: await api.storageState() });
    const page = await ctx.newPage();
    await page.goto("/profile");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /حذف/ }).last().click();
    await expect(page).toHaveURL(/\/login\?status=deleted/);

    const { data } = await serviceClient().from("doctors").select("is_active").eq("id", doctor.id).single();
    expect(data!.is_active).toBe(false);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    const again = await api.post("/api/login/password", { data: { email, password: PASSWORD } });
    expect(again.status()).toBe(401);
    await ctx.close();
    await api.dispose();
  });
});
