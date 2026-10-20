// A doctor's own account: photo upload and the deletion request.

import path from "node:path";
import { request } from "@playwright/test";
import { BASE_URL, PASSWORD, THROWAWAY_ACCOUNTS } from "../env";
import { expect, test } from "../fixtures";
import { seededIds, stateFile } from "../helpers";
import { serviceClient } from "../seed";

test.describe("photo", () => {
  test.use({ storageState: stateFile("doctor") });
  test.afterAll(async () => {
    await serviceClient().from("doctors").update({ profile_picture_url: null }).eq("id", seededIds().samer);
  });

  test("a real image uploads and shows; a renamed text file is refused @phone", async ({ page }) => {
    await page.goto("/profile");
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("not an image at all") });
    await expect(page.getByText(/صيغة|نوع|غير مدعوم/).first()).toBeVisible();

    await input.setInputFiles(path.join(__dirname, "../pixel.png"));
    await expect(page.getByRole("button", { name: "تغيير الصورة" })).toBeVisible();
    const { data } = await serviceClient().from("doctors").select("profile_picture_url").eq("id", seededIds().samer).single();
    expect(data!.profile_picture_url).toMatch(/\/storage\/v1\/object\/public\/doctor-photos\//);
    // The stored file is served back.
    expect((await page.request.get(data!.profile_picture_url!)).status()).toBe(200);
  });
});

test.describe("deletion request", () => {
  const email = THROWAWAY_ACCOUNTS[0];
  let doctorId = "";
  let userId = "";

  test.beforeAll(async () => {
    // A throwaway account: the request closes it for good.
    const db = serviceClient();
    const { data: u } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    userId = u.user!.id;
    const { data: d } = await db
      .from("doctors")
      .insert({
        auth_user_id: userId,
        phone_e164: "+972521234599",
        license_number: "599001",
        arabic_first_name: "مغادر",
        arabic_family_name: "قريبًا",
        arabic_first_name_normalized: "مغادر",
        arabic_family_name_normalized: "قريبا",
        arabic_full_name_normalized: "مغادر قريبا",
        hebrew_first_name: "מע'אדר",
        hebrew_family_name: "קריבן",
        consent_directory_use: true,
        is_phone_verified: true,
        is_admin_approved: true,
      })
      .select("id")
      .single();
    doctorId = d!.id;
  });
  test.afterAll(async () => {
    const db = serviceClient();
    await db.from("doctors").delete().eq("id", doctorId);
    await db.auth.admin.deleteUser(userId).catch(() => {});
  });

  test("closes the account, signs the doctor out and keeps them out", async ({ browser }) => {
    const api = await request.newContext({ baseURL: BASE_URL });
    expect((await api.post("/api/login/password", { data: { email, password: PASSWORD } })).ok()).toBe(true);
    const ctx = await browser.newContext({ storageState: await api.storageState() });
    const page = await ctx.newPage();
    await page.goto("/profile");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /حذف/ }).last().click();
    await expect(page).toHaveURL(/\/login\?status=deleted/);

    const { data } = await serviceClient().from("doctors").select("is_active").eq("id", doctorId).single();
    expect(data!.is_active).toBe(false);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    const again = await api.post("/api/login/password", { data: { email, password: PASSWORD } });
    expect(again.status()).toBe(401);
    await ctx.close();
    await api.dispose();
  });
});
