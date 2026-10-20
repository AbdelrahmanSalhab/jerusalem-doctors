// Phone signup, end to end: the form, Turnstile (Cloudflare's always-pass test
// key), Supabase phone auth with a fixed test code (supabase/config.toml), the
// registry check, and the account it creates.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { flushRateLimits } from "../global-setup";
import { serviceClient } from "../seed";

/** Numbers supabase/config.toml maps to the code 123456. */
const PHONES = { matched: "+972521110001", unknown: "+972521110002" };

test.beforeEach(flushRateLimits);

test.afterAll(async () => {
  const db = serviceClient();
  const { data } = await db.from("doctors").select("id, auth_user_id").in("phone_e164", Object.values(PHONES));
  for (const d of data ?? []) {
    await db.from("doctors").delete().eq("id", d.id);
    if (d.auth_user_id) await db.auth.admin.deleteUser(d.auth_user_id);
  }
});

interface Signup {
  phone: string;
  license: string;
  arabic: [string, string];
  hebrew: [string, string];
}

async function signUp(page: Page, s: Signup) {
  await page.goto("/signup");
  await page.getByLabel("رقم الهاتف").fill(s.phone.replace("+972", "0"));
  await page.getByLabel(/^رقم الترخيص/).fill(s.license);
  await page.getByLabel("البريد الإلكتروني").fill(`${s.license}@example.test`);
  await page.getByRole("button", { name: "التالي" }).click();

  await page.getByLabel("الاسم بالعربية").fill(s.arabic[0]);
  await page.getByLabel("اسم العائلة بالعربية").fill(s.arabic[1]);
  await page.getByLabel(/^الاسم بالعبرية/).fill(s.hebrew[0]);
  await page.getByLabel(/^اسم العائلة بالعبرية/).fill(s.hebrew[1]);
  await page.getByRole("button", { name: "التالي" }).click();

  await page.getByRole("radio", { name: /طب عام/ }).check();
  // Looking for work: the workplace becomes optional (#82).
  await page.getByRole("checkbox", { name: /أبحث عن فرصة عمل/ }).check();
  await expect(page.getByRole("heading", { name: "مكان العمل (اختياري)" })).toBeVisible();
  await page.getByRole("checkbox", { name: /أوافق على ما ورد أعلاه/ }).check();
  await page.getByRole("button", { name: "تسجيل وإرسال رمز التحقق برسالة نصية" }).click();

  await expect(page).toHaveURL(/\/verify\?mode=signup/, { timeout: 15_000 });
  await page.getByLabel("رمز التحقق").fill("123456");
  await page.getByRole("button", { name: "تأكيد" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

test("a doctor the registry knows signs up and is listed straight away @phone", async ({ page, browser }) => {
  await signUp(page, { phone: PHONES.matched, license: "510020", arabic: ["سمير", "خوري"], hebrew: ["סמיר", "חורי"] });
  await expect(page.getByRole("heading", { name: "مرحبًا د. سمير" })).toBeVisible();
  await expect(page.getByText("حسابك قيد المراجعة")).toHaveCount(0);

  const { data } = await serviceClient()
    .from("doctors")
    .select("is_admin_approved, license_verification_status, seeking_work, career_stage")
    .eq("phone_e164", PHONES.matched)
    .single();
  expect(data).toEqual({ is_admin_approved: true, license_verification_status: "verified", seeking_work: true, career_stage: null });

  // A colleague finds them, marked as looking for work.
  const colleague = await browser.newContext({ storageState: (await import("../helpers")).stateFile("doctor") });
  const p = await colleague.newPage();
  await p.goto("/dashboard");
  await p.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("سمير");
  await expect(p.getByText("سمير خوري").first()).toBeVisible();
  await expect(p.getByText("يبحث عن فرصة عمل").first()).toBeVisible();
  await colleague.close();
});

test("a licence the registry does not have waits for an admin", async ({ page }) => {
  await signUp(page, { phone: PHONES.unknown, license: "599999", arabic: ["مجهول", "الترخيص"], hebrew: ["מג'הול", "אלתרח'יס"] });
  await expect(page.getByText("حسابك قيد المراجعة")).toBeVisible();
  const { data } = await serviceClient().from("doctors").select("is_admin_approved").eq("phone_e164", PHONES.unknown).single();
  expect(data!.is_admin_approved).toBe(false);
});
