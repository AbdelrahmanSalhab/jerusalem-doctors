// Reporting a profile that is not who it says (#30): a doctor from a card,
// anyone from the public form, and the admin closing a report.

import { expect, test } from "../fixtures";
import { flushRateLimits } from "../global-setup";
import { seededIds, stateFile } from "../helpers";
import { serviceClient } from "../seed";

test.beforeEach(flushRateLimits);
test.afterAll(async () => {
  await serviceClient().from("profile_reports").delete().neq("id", "00000000-0000-0000-0000-000000000000");
});

test("a doctor reports a card, someone reports by licence, and an admin closes a report", async ({ browser }) => {
  const laila = seededIds().laila;

  const doctor = await browser.newContext({ storageState: stateFile("doctor") });
  const d = await doctor.newPage();
  await d.goto("/dashboard");
  await d.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("ليلى");
  const card = d.getByRole("article").filter({ hasText: "ليلى" }).first();
  await card.getByRole("button", { name: "أبلغ عن هذا الملف" }).click();
  await card.getByRole("textbox").fill("هذه ليست الدكتورة ليلى الحقيقية");
  await card.getByRole("button", { name: "إرسال للإدارة" }).click();
  await expect(card.getByText("وصل بلاغك إلى الإدارة")).toBeVisible();
  await doctor.close();

  // The public form, as a visitor with no account; 510001 is ليلى's licence.
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto("/report?license=510001");
  await expect(v.getByLabel(/^رقم الترخيص المعني/)).toHaveValue("510001");
  await v.getByLabel(/^اسمك/).fill("ليلى الحقيقية");
  await v.getByLabel(/^رقم هاتفك أو بريدك/).fill("0529990002");
  await v.getByLabel(/^ماذا حدث/).fill("سجّل أحدهم برقم ترخيصي");
  await v.getByRole("button", { name: "إرسال البلاغ" }).click();
  await expect(v.getByText("وصلنا بلاغك")).toBeVisible();
  await visitor.close();

  const { data } = await serviceClient().from("profile_reports").select("source, target_doctor_id").order("created_at");
  expect(data).toEqual([
    { source: "card", target_doctor_id: laila },
    { source: "public", target_doctor_id: laila },
  ]);

  const admin = await browser.newContext({ storageState: stateFile("admin") });
  const a = await admin.newPage();
  await a.goto("/admin/reports");
  await expect(a.getByRole("link", { name: /البلاغات\s*2/ })).toBeVisible();
  const first = a.getByRole("listitem").filter({ hasText: "هذه ليست الدكتورة ليلى الحقيقية" });
  await first.getByRole("button", { name: "إغلاق…" }).click();
  await first.getByLabel("ملاحظة الإغلاق").fill("تواصلت مع الطرفين، الملف صحيح");
  await first.getByRole("button", { name: "إغلاق البلاغ" }).click();
  await expect(a.getByText("هذه ليست الدكتورة ليلى الحقيقية")).toHaveCount(0);
  await expect(a.getByText("سجّل أحدهم برقم ترخيصي")).toBeVisible();
  await admin.close();
});
