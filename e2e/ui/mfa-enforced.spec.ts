// The second factor with ADMIN_MFA=1, the setting that can lock admins out if
// the real tokens do not carry what lib/auth/mfa.ts reads. Runs only when the
// server was started with it: E2E_ADMIN_MFA=1 npx playwright test e2e/ui/mfa-enforced.spec.ts
// (the other specs' shared admin sessions cannot give a code, so CI does not).
//
// What it proves with real Supabase tokens: an enrolled admin's password
// session is sent to the code step until the code is given, and then opens
// /admin; a password session without a factor cannot enrol one on its own;
// and one that a super admin reset can, within its window.

import { createHmac } from "node:crypto";
import { PASSWORD } from "../env";
import { expect, test } from "../fixtures";
import { flushRateLimits } from "../global-setup";
import { createDoctor, serviceClient } from "../seed";

test.skip(process.env.E2E_ADMIN_MFA !== "1", "needs the server started with ADMIN_MFA=1");
test.use({ storageState: { cookies: [], origins: [] } });

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

test("with the flag on, enrolment needs a reset window and /admin needs the code", async ({ page }) => {
  await flushRateLimits();
  const db = serviceClient();
  const doctor = await createDoctor({ first: "مسؤول", family: "مُلزَم", loginEmail: "enforced@e2e.test", admin: true, visible: false });
  const other = await createDoctor({ first: "مسؤول", family: "بلا نافذة", loginEmail: "unenrolled@e2e.test", admin: true, visible: false });
  const signIn = async (email: string) => {
    await page.goto("/login/dev");
    await page.getByLabel("البريد الإلكتروني").fill(email);
    await page.getByLabel("كلمة المرور").fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  };
  try {
    // No window: a password session cannot claim a factor.
    await signIn("unenrolled@e2e.test");
    await expect(page).toHaveURL(/\/dashboard/);
    expect((await page.request.post("/api/mfa/enroll")).status()).toBe(403);
    await page.context().clearCookies();

    // A super admin's reset opens the window.
    const { data: row } = await db.from("doctors").select("auth_user_id").eq("id", doctor.id).single();
    await db.auth.admin.updateUserById(row!.auth_user_id!, { app_metadata: { mfa_enrol_until: Date.now() + 15 * 60_000 } });
    await signIn("enforced@e2e.test");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/profile");
    await page.getByRole("button", { name: "تفعيل التحقق بخطوتين" }).click();
    const secret = (await page.locator("span.select-all").innerText()).trim();
    await page.getByLabel("الرمز", { exact: true }).fill(totp(secret));
    await page.getByRole("button", { name: "تأكيد" }).click();
    await expect(page.getByRole("status").filter({ hasText: "مفعّل" })).toBeVisible();
    // Confirming closed the window.
    expect((await db.auth.admin.getUserById(row!.auth_user_id!)).data.user?.app_metadata.mfa_enrol_until ?? null).toBeNull();

    // The same session now has the code, so /admin opens; a new one does not until it gives it.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin/);
    await page.context().clearCookies();
    await signIn("enforced@e2e.test");
    await page.getByLabel("رمز تطبيق المصادقة").waitFor();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\/dev\?code=1/);
    await page.getByLabel("رمز تطبيق المصادقة").fill(totp(secret));
    await page.getByRole("button", { name: "تأكيد" }).click();
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { name: /الأطباء|إدارة/ }).first()).toBeVisible();
  } finally {
    await doctor.remove();
    await other.remove();
    await flushRateLimits();
  }
});
