// An admin turns on the authenticator code from «ملفي», and from then on a
// password sign-in asks for it before the admin panel opens (#164). The
// ADMIN_MFA flag only decides whether /admin insists; the code step itself
// shows as soon as a factor exists, which is what is checked here. A
// throwaway admin, so the shared test sessions stay.

import { createHmac } from "node:crypto";
import { PASSWORD } from "../env";
import { expect, test } from "../fixtures";
import { flushRateLimits } from "../global-setup";
import { createDoctor } from "../seed";

const EMAIL = "authenticator@e2e.test";

test.use({ storageState: { cookies: [], origins: [] } });

/** The 6-digit code an authenticator app shows for a base32 secret (RFC 6238). */
function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("an admin enrols an authenticator and is then asked for its code at sign-in", async ({ page }) => {
  await flushRateLimits();
  const admin = await createDoctor({ first: "مسؤول", family: "مصادقة", loginEmail: EMAIL, admin: true, visible: false });
  const signIn = async () => {
    await page.goto("/login/dev");
    await page.getByLabel("البريد الإلكتروني").fill(EMAIL);
    await page.getByLabel("كلمة المرور").fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  };
  try {
    await signIn();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/profile");

    await page.getByRole("button", { name: "تفعيل التحقق بخطوتين" }).click();
    const secret = (await page.locator("span.select-all").innerText()).trim();
    await page.getByLabel("الرمز", { exact: true }).fill("000000");
    await page.getByRole("button", { name: "تأكيد" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "غير صحيح" })).toBeVisible();
    await page.getByLabel("الرمز", { exact: true }).fill(totp(secret));
    await page.getByRole("button", { name: "تأكيد" }).click();
    await expect(page.getByRole("status").filter({ hasText: "مفعّل" })).toBeVisible();

    // A new sign-in: the password is not the end of it any more.
    await page.context().clearCookies();
    await signIn();
    await expect(page.getByLabel("رمز تطبيق المصادقة")).toBeVisible();
    await expect(page).not.toHaveURL(/\/dashboard/);
    await page.getByLabel("رمز تطبيق المصادقة").fill(totp(secret));
    await page.getByRole("button", { name: "تأكيد" }).click();
    await expect(page).toHaveURL(/\/admin/);
  } finally {
    await admin.remove();
    await flushRateLimits();
  }
});
