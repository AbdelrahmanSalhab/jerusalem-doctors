// An admin changes the password of their email sign-in from «ملفي»
// (/api/profile/password): the current one is checked, and every other
// session is signed out. A throwaway admin, so the shared test sessions stay.

import { request as http, type APIRequestContext } from "@playwright/test";
import { BASE_URL, PASSWORD } from "../env";
import { expect, test } from "../fixtures";
import { flushRateLimits } from "../global-setup";
import { stateFile } from "../helpers";
import { createDoctor, serviceClient } from "../seed";

const EMAIL = "rotating@e2e.test";
const NEXT = "a-much-longer-new-password-2026";

test.use({ storageState: { cookies: [], origins: [] } });

/** The access token in a context's Supabase session cookie (@supabase/ssr:
 *  "base64-" and the session's JSON, split over .0, .1, ... when long). */
async function accessTokenOf(ctx: APIRequestContext): Promise<string> {
  const parts = (await ctx.storageState()).cookies
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const raw = parts.map((c) => c.value).join("").replace(/^base64-/, "");
  return JSON.parse(Buffer.from(raw, "base64url").toString()).access_token;
}

/** A signed-in API session of its own, like a second browser. */
async function signedIn(password: string): Promise<APIRequestContext> {
  const ctx = await http.newContext({ baseURL: BASE_URL });
  const res = await ctx.post("/api/login/password", { data: { email: EMAIL, password } });
  expect(res.status(), `sign in with ${password === PASSWORD ? "the old" : "the new"} password`).toBe(200);
  return ctx;
}

test("an admin changes their password, and their other sessions end", async ({ page }) => {
  await flushRateLimits();
  const admin = await createDoctor({ first: "مسؤول", family: "مؤقت", loginEmail: EMAIL, admin: true, visible: false });
  try {
    const elsewhere = await signedIn(PASSWORD);
    expect((await elsewhere.get("/api/admin/migrations")).status()).toBe(200);

    await page.goto("/login/dev");
    await page.getByLabel("البريد الإلكتروني").fill(EMAIL);
    await page.getByLabel("كلمة المرور").fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/profile");

    await page.getByLabel("كلمة المرور الحالية").fill("not-the-password");
    await page.getByLabel("كلمة المرور الجديدة", { exact: true }).fill(NEXT);
    await page.getByLabel("أعد كتابة كلمة المرور الجديدة").fill(NEXT);
    await page.getByRole("button", { name: "تغيير كلمة المرور" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "غير صحيحة" })).toHaveText("كلمة المرور الحالية غير صحيحة.");

    await page.getByLabel("كلمة المرور الحالية").fill(PASSWORD);
    await page.getByRole("button", { name: "تغيير كلمة المرور" }).click();
    await expect(page.getByRole("status").filter({ hasText: "تم تغيير" })).toBeVisible();

    // The other session is over: the auth server no longer knows it, so it
    // can't be renewed. (Pages check a token's signature, so its current
    // token works out its hour, as the form says.)
    const { error: gone } = await serviceClient().auth.getUser(await accessTokenOf(elsewhere));
    expect(gone, "the other session is still valid on the auth server").not.toBeNull();
    await page.reload();
    await expect(page.getByRole("heading", { name: "ملفي" })).toBeVisible();

    // Only the new password signs in now.
    const old = await http.newContext({ baseURL: BASE_URL });
    expect((await old.post("/api/login/password", { data: { email: EMAIL, password: PASSWORD } })).status()).toBe(401);
    await (await signedIn(NEXT)).dispose();
    await Promise.all([elsewhere.dispose(), old.dispose()]);
  } finally {
    await admin.remove();
    await flushRateLimits();
  }
});

test.describe("a doctor", () => {
  test.use({ storageState: stateFile("doctor") });

  test("has no password section", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "ملفي" })).toBeVisible();
    await expect(page.getByText("كلمة المرور الحالية")).toHaveCount(0);
  });
});
