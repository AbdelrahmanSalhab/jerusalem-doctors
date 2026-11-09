import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";
import { createDoctor, serviceClient } from "../seed";

test.use({ storageState: stateFile("admin") });

test("the filter bar counts doctors, not the hidden admin account", async ({ page }) => {
  await page.goto("/admin");
  // Seeded: one doctor waiting (منتظر القبول), one hidden (خفي المخفي); the
  // hidden non-doctor admin is in neither.
  await expect(page.getByRole("link", { name: /بانتظار القبول\s*1$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /مخفي من الدليل\s*1$/ })).toBeVisible();
});

test.describe("accepting a doctor", () => {
  let waiting: Awaited<ReturnType<typeof createDoctor>>;
  test.beforeEach(async () => {
    waiting = await createDoctor({ first: "طالب", family: "القبول", approved: false });
  });
  test.afterEach(async () => waiting.remove());

  test("an admin accepts a waiting doctor, who then appears in the directory", async ({ page, browser }) => {
    await page.goto("/admin?status=pending&q=طالب");
    // The search leaves this doctor alone on screen.
    await expect(page.getByText("طالب القبول")).toBeVisible();
    // The row opens the panel; the decision is taken there, record in view.
    await page.getByRole("button", { name: "مراجعة وقبول" }).click();
    await expect(page.getByText("التحقق من الترخيص")).toBeVisible();
    await page.getByRole("button", { name: "قبول العضوية" }).click();
    // Even an exact registry match asks how the admin knows (#16).
    await expect(page.getByText(/لا يثبت أنه صاحبها/)).toBeVisible();
    await expect(page.getByText(/لا تعتمد على رقم هاتف أو مكان عمل مكتوب في ملفه/)).toBeVisible();
    expect((await serviceClient().from("doctors").select("is_admin_approved").eq("id", waiting.id).single()).data?.is_admin_approved).toBe(false);
    await page.getByRole("radio", { name: /اتصلت بمكان عمله/ }).check();
    await page.getByLabel("سبب القبول").fill("اتصلت بمقسم المستشفى وأكّدوا أنه يعمل عندهم");
    await page.getByRole("button", { name: "قبول العضوية" }).last().click();
    await expect
      .poll(async () => (await serviceClient().from("doctors").select("is_admin_approved").eq("id", waiting.id).single()).data?.is_admin_approved)
      .toBe(true);
    // Doctors get no push: the admin is handed the WhatsApp message to send.
    await expect(page.getByRole("link", { name: "أرسل رسالة واتساب" })).toHaveAttribute("href", /wa\.me\/.*text=/);

    const doctor = await browser.newContext({ storageState: stateFile("doctor") });
    const p = await doctor.newPage();
    await p.goto("/dashboard");
    await p.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("طالب");
    await expect(p.getByText("طالب القبول").first()).toBeVisible();
    await doctor.close();
  });

  test("a method alone is enough to accept, and so is a note alone", async ({ page }) => {
    const accept = async (fill: () => Promise<void>) => {
      await page.goto("/admin?status=pending&q=طالب");
      await page.getByRole("button", { name: "مراجعة وقبول" }).click();
      await page.getByRole("button", { name: "قبول العضوية" }).click();
      // Neither a method nor a note: the prompt says so and nothing is saved.
      await page.getByRole("button", { name: "قبول العضوية" }).last().click();
      await expect(page.getByText("اختر كيف تأكّدت من هويته، أو اكتب ملاحظة.")).toBeVisible();
      await fill();
      await page.getByRole("button", { name: "قبول العضوية" }).last().click();
      await expect
        .poll(async () => (await serviceClient().from("doctors").select("is_admin_approved").eq("id", waiting.id).single()).data?.is_admin_approved)
        .toBe(true);
    };
    await accept(async () => {
      await page.getByRole("radio", { name: /أعرفه شخصيًا/ }).check();
    });
    await serviceClient().from("doctors").update({ is_admin_approved: false, approved_at: null }).eq("id", waiting.id);
    await accept(async () => {
      await page.getByLabel("سبب القبول").fill("زميلي في القسم منذ سنتين");
    });
  });

  test("goes through the waiting doctors with التالي, without closing the panel", async ({ page }) => {
    const second = await createDoctor({ first: "طالب", family: "الثاني", approved: false });
    try {
      await page.goto("/admin?status=pending&q=طالب");
      await expect(page.getByText("طالب الثاني")).toBeVisible();
      await page.getByRole("button", { name: "مراجعة وقبول" }).first().click();
      const panel = page.getByRole("dialog");
      const first = await panel.getByRole("heading", { level: 2 }).innerText();
      await panel.getByRole("link", { name: "التالي" }).click();
      await expect(panel.getByRole("heading", { level: 2 })).not.toHaveText(first);
      await expect(panel.getByRole("link", { name: "السابق" })).toBeVisible();
    } finally {
      await second.remove();
    }
  });

  test("keeps Tab inside the open panel, and says which doctor of how many it is", async ({ page }) => {
    await page.goto("/admin?status=pending&q=طالب");
    await page.getByRole("button", { name: "مراجعة وقبول" }).first().click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText(/^\d+ من \d+$/)).toBeVisible();
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.querySelector('[role="dialog"]')!.contains(document.activeElement)), `Tab ${i}`).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => document.querySelector('[role="dialog"]')!.contains(document.activeElement)), `Shift+Tab ${i}`).toBe(true);
    }
  });

  // The registry says "verified", but an admin set the number by hand: the
  // match says nothing about who the doctor is, so accepting asks why.
  test("asks for a reason when an admin set the verified number by hand", async ({ page }) => {
    await serviceClient().from("audit_logs").insert({
      action: "admin_license_corrected",
      target_doctor_id: waiting.id,
      metadata: { slot: "primary", via_name_lookup: true },
    });
    await page.goto("/admin?status=pending&q=طالب");
    await expect(page.getByText("طالب القبول")).toBeVisible();
    // The row opens the panel; the decision is taken there, record in view.
    await page.getByRole("button", { name: "مراجعة وقبول" }).click();
    await expect(page.getByText("التحقق من الترخيص")).toBeVisible();
    await page.getByRole("button", { name: "قبول العضوية" }).click();
    await expect(page.getByText(/حدّدته الإدارة بيدها/)).toBeVisible();
    expect((await serviceClient().from("doctors").select("is_admin_approved").eq("id", waiting.id).single()).data?.is_admin_approved).toBe(false);
    await page.getByRole("radio", { name: /رأيت صورة/ }).check();
    await page.getByLabel("سبب القبول").fill("تأكّدت من صورة الترخيص الأصلية");
    await page.getByRole("button", { name: "قبول العضوية" }).last().click();
    await expect
      .poll(async () => (await serviceClient().from("doctors").select("is_admin_approved").eq("id", waiting.id).single()).data?.is_admin_approved)
      .toBe(true);
  });
});

// #16: the doctors accepted at signup on a registry match alone have never had
// an admin satisfy themselves it is them; the list says so and a review clears it.
test.describe("identity review of an accepted doctor", () => {
  let accepted: Awaited<ReturnType<typeof createDoctor>>;
  test.beforeEach(async () => {
    accepted = await createDoctor({ first: "قديم", family: "المراجعة", identityReviewed: false });
  });
  test.afterEach(async () => accepted.remove());

  // A hidden admin account is staff: accepted, never reviewed, and not in the list.
  test("leaves out staff accounts, which are not doctors", async ({ page }) => {
    const staff = await createDoctor({ first: "قديم", family: "الإدارة", admin: true, visible: false, identityReviewed: false });
    try {
      await page.goto("/admin?status=identity&q=قديم");
      await expect(page.getByText("قديم المراجعة")).toBeVisible();
      await expect(page.getByText("قديم الإدارة")).toHaveCount(0);
    } finally {
      await staff.remove();
    }
  });

  test("is listed until an admin says how they knew, then leaves the list", async ({ page }) => {
    await page.goto("/admin?status=identity&q=قديم");
    await expect(page.getByText("قديم المراجعة")).toBeVisible();
    await expect(page.getByText("لم تُراجَع هويته").first()).toBeVisible();

    await page.getByRole("button", { name: "قديم المراجعة" }).click();
    await page.getByRole("button", { name: "مراجعة الهوية" }).click();
    // Either a method or a note is enough, like accepting.
    await page.getByRole("button", { name: "تمت مراجعة الهوية" }).click();
    await expect(page.getByText("اختر كيف تأكّدت من هويته، أو اكتب ملاحظة.")).toBeVisible();
    await page.getByRole("radio", { name: /رأيت صورة/ }).check();
    await page.getByLabel("سبب المراجعة").fill("رأيت صورة الترخيص الأصلية معه");
    await page.getByRole("button", { name: "تمت مراجعة الهوية" }).click();
    await expect(page.getByText(/روجعت هوية هذا الطبيب في/)).toBeVisible();

    const { data } = await serviceClient().from("doctors").select("identity_reviewed_at").eq("id", accepted.id).single();
    expect(data!.identity_reviewed_at).not.toBeNull();
    await page.goto("/admin?status=identity&q=قديم");
    await expect(page.getByText("قديم المراجعة")).toHaveCount(0);
  });
});

test("the panel opens from the activity log", async ({ page }) => {
  await page.goto("/admin/audit");
  // An entry opens on click; the first one about a doctor has the link.
  // Collapsed content is hidden from role queries, so this one is by markup.
  const entry = page.locator("details:has(a[href^='/admin?doctor='])").first();
  await entry.locator(":scope > summary").click();
  await entry.getByRole("link", { name: "فتح الطبيب في قائمة الأطباء" }).click();
  await expect(page).toHaveURL(/\/admin\?doctor=/);
  await expect(page.getByText("التحقق من الترخيص")).toBeVisible();
});

test("a licence the registry does not list leaves «ترخيص يحتاج مراجعة» once an admin reviewed it", async ({ page }) => {
  const doctor = await createDoctor({ first: "مراجع", family: "الترخيص", licenseStatus: "not_found" });
  try {
    await page.goto("/admin?status=license&q=مراجع");
    await expect(page.getByText("مراجع الترخيص").first()).toBeVisible();

    await page.goto(`/admin?status=license&doctor=${doctor.id}`);
    await page.getByLabel("ملاحظة (اختياري)").fill("تحققت من الشهادة");
    await page.getByRole("button", { name: "تمت المراجعة" }).click();
    await expect(page.getByText(/روجع هذا الترخيص في/)).toBeVisible();

    // Out of the queue, though the registry still does not list it.
    await page.goto("/admin?status=license&q=مراجع");
    await expect(page.getByText("مراجع الترخيص")).toHaveCount(0);
    const db = serviceClient();
    expect((await db.from("doctors").select("license_verification_status, license_reviewed_at").eq("id", doctor.id).single()).data).toMatchObject({
      license_verification_status: "not_found",
      license_reviewed_at: expect.any(String),
    });
    expect((await db.from("audit_logs").select("metadata").eq("target_doctor_id", doctor.id).eq("action", "admin_license_reviewed").single()).data?.metadata).toEqual({
      license_status: "not_found",
      note: "تحققت من الشهادة",
    });
  } finally {
    await doctor.remove();
  }
});

test.describe("the tab bar", () => {
  // The row scrolls sideways when it does not fit, which hides the tabs past the edge.
  test("the five tabs fit a phone without scrolling sideways @phone", async ({ page }) => {
    await page.goto("/admin");
    const row = await page.getByRole("navigation", { name: "أقسام الإدارة" }).evaluate((n) => ({ scroll: n.scrollWidth, shown: n.clientWidth }));
    expect(row.scroll).toBeLessThanOrEqual(row.shown + 1);
  });

  test("groups pages, and lights the one pill that is open", async ({ page }) => {
    await page.goto("/admin/audit?action=alert");
    const tabs = page.getByRole("navigation", { name: "أقسام الإدارة" });
    await expect(tabs.getByRole("link", { name: /سجل النشاط/ })).toHaveAttribute("aria-current", "true");
    const pills = page.getByRole("navigation", { name: /سجل النشاط: صفحات القسم/ });
    await expect(pills.getByRole("link", { name: /التنبيهات/ })).toHaveAttribute("aria-current", "page");
    await expect(pills.getByRole("link", { name: "كل الأحداث" })).not.toHaveAttribute("aria-current", "page");

    await page.goto("/admin/audit");
    await expect(pills.getByRole("link", { name: "كل الأحداث" })).toHaveAttribute("aria-current", "page");
    await expect(pills.getByRole("link", { name: /التنبيهات/ })).not.toHaveAttribute("aria-current", "page");

    // The pages a tab groups share it, and the tab says it is open.
    await page.goto("/admin/reports");
    await expect(tabs.getByRole("link", { name: /الطلبات/ })).toHaveAttribute("aria-current", "true");
    // Unfinished signups are a log of nudges, not work: with the activity log.
    await page.goto("/admin/signups");
    await expect(tabs.getByRole("link", { name: /سجل النشاط/ })).toHaveAttribute("aria-current", "true");
    await expect(pills.getByRole("link", { name: "تسجيلات لم تكتمل" })).toHaveAttribute("aria-current", "page");
    await page.goto("/admin/specialties");
    await expect(tabs.getByRole("link", { name: "الإعدادات" })).toHaveAttribute("aria-current", "true");
    // Open already, the tab goes to the page the admin is on rather than the group's landing.
    await expect(tabs.getByRole("link", { name: "الإعدادات" })).toHaveAttribute("href", "/admin/specialties");
    // The directory's switches are a page of the same group.
    await page.goto("/admin/settings");
    await expect(tabs.getByRole("link", { name: "الإعدادات" })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("navigation", { name: /الإعدادات: صفحات القسم/ }).getByRole("link", { name: "الدليل" })).toHaveAttribute("aria-current", "page");
  });
});
