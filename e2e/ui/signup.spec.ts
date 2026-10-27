// Phone signup, end to end: the form, Turnstile (Cloudflare's always-pass test
// key), Supabase phone auth with a fixed test code (supabase/config.toml), the
// registry check, and the account it creates.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { STUB_URL } from "../env";
import { flushRateLimits } from "../global-setup";
import { createDoctor, serviceClient } from "../seed";

/** Numbers supabase/config.toml maps to the code 123456. */
const PHONES = { matched: "+972521110001", unknown: "+972521110002", returning: "+972521110003" };

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

/** Fills the three steps and lands on the code page. */
async function toVerify(page: Page, s: Signup) {
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
}

async function signUp(page: Page, s: Signup) {
  await toVerify(page, s);
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

// Its own number and account: Auth sends one code per number every 5
// seconds, so reusing the test above's number made this one flaky.
test("signing up again with a registered number signs its owner in and says so", async ({ page }) => {
  await createDoctor({ first: "عائد", family: "الرقم", phone: PHONES.returning });
  await signUp(page, { phone: PHONES.returning, license: "599998", arabic: ["مكرر", "الرقم"], hebrew: ["מכרר", "אלרקם"] });
  await expect(page).toHaveURL(/\/dashboard\?existing=1/);
  await expect(page.getByText("هذا الرقم مسجَّل مسبقًا.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "مرحبًا د. عائد" })).toBeVisible();
  const { count } = await serviceClient().from("doctors").select("id", { count: "exact", head: true }).eq("phone_e164", PHONES.returning);
  expect(count).toBe(1);
});

/** Steps one and two with throwaway values, ending on the last step. */
async function toLastStep(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("رقم الهاتف").fill("0521110009");
  await page.getByLabel(/^رقم الترخيص/).fill("599996");
  await page.getByLabel("البريد الإلكتروني").fill("order@example.test");
  await page.getByRole("button", { name: "التالي" }).click();
  await page.getByLabel("الاسم بالعربية").fill("ترتيب");
  await page.getByLabel("اسم العائلة بالعربية").fill("الأقسام");
  await page.getByLabel(/^الاسم بالعبرية/).fill("סדר");
  await page.getByLabel(/^اسم العائلة بالعبرية/).fill("סדר");
  await page.getByRole("button", { name: "التالي" }).click();
}

test("a specialist sees their services after their specialty", async ({ page }) => {
  await toLastStep(page);
  await page.getByRole("radio", { name: /طبيب أخصائي/ }).check();

  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  const specialty = headings.indexOf("التخصص");
  const services = headings.findIndex((h) => h.startsWith("الخدمات والشهادات"));
  expect(specialty).toBeGreaterThanOrEqual(0);
  expect(services).toBeGreaterThan(specialty);
});

test("a resident can't also be retired: each greys the other out and says why @phone", async ({ page }) => {
  await toLastStep(page);
  const resident = page.getByRole("radio", { name: /طبيب مقيم/ });
  const retired = page.getByRole("checkbox", { name: /أنا طبيب متقاعد/ });

  await resident.check();
  await expect(retired).toBeDisabled();
  await expect(page.getByText("لا يجتمع مع «طبيب مقيم».")).toBeVisible();

  await page.getByRole("radio", { name: /طبيب أخصائي/ }).check();
  await expect(retired).toBeEnabled();
  await retired.check();
  await expect(resident).toBeDisabled();
  await expect(page.getByText("لا يجتمع مع «متقاعد». ألغِ «متقاعد» أولًا إن كنت مقيمًا.")).toBeVisible();
});

/** The code in the newest text the stub "sent" to a number (lib/otp/message.ts
 *  puts it first). */
async function newestCode(phone: string): Promise<string | undefined> {
  const texts = (await (await fetch(`${STUB_URL}/sms4free/messages?to=${phone.replace("+972", "0")}`)).json()) as { msg: string }[];
  return texts.at(-1)?.msg.match(/^(\d{6}) /)?.[1];
}

// Doctors reported "two codes, both wrong": a code lives a minute, and a new
// one cancels the last, so the older text, often the first to arrive, fails.
// An ordinary number, so real codes go through the hook to the stub.
test("a new code cancels the old one, and the page says to use the newest @phone", async ({ page }) => {
  const phone = "+972521110077";
  try {
    await toVerify(page, { phone, license: "599991", arabic: ["أحدث", "رمز"], hebrew: ["חדש", "קוד"] });
    await expect.poll(() => newestCode(phone)).toMatch(/^\d{6}$/);
    const first = (await newestCode(phone))!;
    await expect(page.getByText("الرمز صالح لمدة دقيقة واحدة فقط من إرساله.")).toBeVisible();

    // The minute runs out (a faked clock, on a reload that keeps the signup).
    await page.clock.install();
    await page.reload();
    await page.clock.runFor("01:01");
    await expect(page.getByText("إن لم يصلك الرمز أو لم يعمل، اطلب رمزًا جديدًا.")).toBeVisible();
    // Supabase sends at most one text per number every 5 s (config.toml).
    await page.waitForTimeout(5_000);
    await page.getByRole("button", { name: "إعادة إرسال الرمز" }).click();
    await expect(page.getByRole("status").filter({ hasText: "أرسلنا رمزًا جديدًا" })).toHaveText(
      "أرسلنا رمزًا جديدًا. استخدم آخر رمز وصلك فقط؛ الرمز السابق لم يعد يعمل.",
    );
    await expect.poll(() => newestCode(phone)).not.toBe(first);
    const second = (await newestCode(phone))!;

    // The older text, typed: refused, and the page says what to do.
    await page.getByLabel("رمز التحقق").fill(first);
    await page.getByRole("button", { name: "تأكيد" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "الرمز غير صحيح أو انتهت صلاحيته. استخدم آخر رمز وصلك، أو اطلب رمزًا جديدًا.",
    );

    // The newest one works.
    await page.getByLabel("رمز التحقق").fill(second);
    await page.getByRole("button", { name: "تأكيد" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  } finally {
    const db = serviceClient();
    const { data } = await db.from("doctors").select("id, auth_user_id").eq("phone_e164", phone);
    for (const d of data ?? []) {
      await db.from("doctors").delete().eq("id", d.id);
      if (d.auth_user_id) await db.auth.admin.deleteUser(d.auth_user_id);
    }
  }
});
