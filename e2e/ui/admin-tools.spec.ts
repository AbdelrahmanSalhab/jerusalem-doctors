// The admin's working tools: licence correction against the registry,
// institutions, residents the registry lists as specialists, and paging
// through and filtering the activity log.

import { expect, test } from "../fixtures";
import { seededIds, stateFile } from "../helpers";
import { createDoctor, serviceClient } from "../seed";

test.use({ storageState: stateFile("admin") });

test.describe("licence correction", () => {
  let doctor: Awaited<ReturnType<typeof createDoctor>>;
  test.beforeEach(async () => {
    // Stored with a number the registry does not have; the registry's 510030
    // is מרים עודה, the same Hebrew name.
    doctor = await createDoctor({ first: "مريم", family: "تصحيح", hebrewFirst: "מרים", hebrewFamily: "עודה", licenseStatus: "not_found" });
  });
  test.afterEach(async () => doctor.remove());

  test("an admin finds the right number in the registry and saves it", async ({ page }) => {
    await page.goto(`/admin?doctor=${doctor.id}`);
    await page.getByRole("button", { name: "بحث في السجل أو تصحيح الرقم" }).first().click();
    await page.getByLabel(/^رقم الترخيص/).first().fill("510030");
    await page.getByRole("button", { name: "بحث في السجل", exact: true }).click();
    await expect(page.getByText("نتيجة البحث")).toBeVisible();
    await page.getByRole("button", { name: "حفظ هذا الرقم" }).click();
    await expect
      .poll(async () => (await serviceClient().from("doctors").select("license_number, license_verification_status").eq("id", doctor.id).single()).data)
      .toEqual({ license_number: "510030", license_verification_status: "verified" });
    // The route writes the activity log after saving the licence, so the
    // entry can land a moment after the row above.
    await expect
      .poll(async () => (await serviceClient().from("audit_logs").select("action").eq("target_doctor_id", doctor.id)).data?.map((a) => a.action))
      .toContain("admin_license_corrected");
  });
});

test.describe("residents the registry lists as specialists", () => {
  const made: Awaited<ReturnType<typeof createDoctor>>[] = [];
  let licences: number[] = [];
  test.beforeAll(async () => {
    const db = serviceClient();
    // One resident whose licence carries a specialty in the registry, one
    // whose licence carries none, and a specialist who does: only the first
    // picked the wrong stage.
    for (const [first, stage] of [["مقيم-خطأ", "resident"], ["مقيم-صح", "resident"], ["أخصائي-صح", "specialist"]] as const) {
      made.push(await createDoctor({ first, family: "فحص", stage }));
    }
    const { data: rows } = await db.from("doctors").select("id, license_number").in("id", made.map((d) => d.id));
    const licenceOf = new Map((rows ?? []).map((r) => [r.id, Number(r.license_number)]));
    licences = [...licenceOf.values()];
    const registry = [
      { id: made[0].id, specialty: "פנימית" },
      { id: made[1].id, specialty: null },
      { id: made[2].id, specialty: "ילדים" },
    ].map(({ id, specialty }) => ({
      license_number: licenceOf.get(id),
      hebrew_first_name: "בדיקה",
      hebrew_family_name: "בדיקה",
      hebrew_first_norm: "בדיקה",
      hebrew_family_norm: "בדיקה",
      specialty_name_he: specialty,
    }));
    const { error } = await db.from("moh_practitioners").insert(registry);
    expect(error).toBeNull();
  });
  test.afterAll(async () => {
    await serviceClient().from("moh_practitioners").delete().in("license_number", licences);
    for (const d of made) await d.remove();
  });

  test("the tab lists only the resident the registry calls a specialist", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("link", { name: "مقيم والسجل يقول أخصائي" }).click();
    await expect(page).toHaveURL(/status=stage/);
    await expect(page.getByText("مقيم-خطأ فحص").first()).toBeVisible();
    await expect(page.getByText("مقيم-صح فحص")).toHaveCount(0);
    await expect(page.getByText("أخصائي-صح فحص")).toHaveCount(0);
  });
});

test.describe("clinics without an address or phone", () => {
  const made: Awaited<ReturnType<typeof createDoctor>>[] = [];
  test.beforeAll(async () => {
    made.push(
      await createDoctor({
        first: "عيادة-ناقصة",
        family: "فحص",
        workplaces: [{ name: "عيادة بلا هاتف", type: "clinic", address: "شارع صلاح الدين 5" }],
      }),
      await createDoctor({
        first: "عيادة-كاملة",
        family: "فحص",
        workplaces: [{ name: "عيادة كاملة", type: "clinic", address: "شارع صلاح الدين 6", phone: "02-6271235" }],
      }),
    );
  });
  test.afterAll(async () => {
    for (const d of made) await d.remove();
  });

  test("the stats line leads to the doctors behind it", async ({ page }) => {
    await page.goto("/admin/stats");
    await page.getByRole("listitem").filter({ hasText: "بلا عنوان أو هاتف" }).getByRole("link", { name: "عرض" }).click();
    await expect(page).toHaveURL(/status=clinic/);
    await expect(page.getByText("عيادة-ناقصة فحص").first()).toBeVisible();
    await expect(page.getByText("عيادة-كاملة فحص")).toHaveCount(0);
  });
});

test.describe("alerts", () => {
  test.beforeAll(async () => {
    // Only this test's alerts: earlier tests raise real ones.
    await serviceClient().from("audit_logs").delete().eq("action", "alert");
    const { error } = await serviceClient()
      .from("audit_logs")
      .insert([
        { action: "alert", metadata: { alert: "sms_cap_reached", level: "error", limit: 200 } },
        // For the record, not for the badge.
        { action: "alert", metadata: { alert: "doctor_waiting", level: "info" } },
      ]);
    expect(error).toBeNull();
  });
  test.afterAll(async () => {
    await serviceClient().from("audit_logs").delete().eq("action", "alert");
  });

  test("the alerts tab counts what needs attention and opens the log on alerts", async ({ page }) => {
    await page.goto("/admin");
    const tab = page.getByRole("link", { name: /التنبيهات/ });
    await expect(tab.getByLabel("تنبيه واحد في آخر 24 ساعة")).toHaveText("1");
    await tab.click();
    await expect(page).toHaveURL(/\/admin\/audit\?action=alert/);
    await expect(page.getByText("حدثان تطابق التصفية")).toBeVisible();
    await expect(page.getByText("عاجل · بلغت الرسائل الحد اليومي", { exact: false })).toBeVisible();
    await expect(page.getByText("للعلم · طبيب جديد بانتظار القبول")).toBeVisible();
  });
});

test("an admin adds an institution and removes it", async ({ page }) => {
  await page.goto("/admin/institutions");
  await page.getByLabel("الاسم بالعربية").fill("مستشفى الاختبار");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.getByText("مستشفى الاختبار").first()).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "مستشفى الاختبار" }).first();
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "حذف" }).click();
  await expect(page.getByText("حُذفت «مستشفى الاختبار»", { exact: false })).toBeVisible();
  const { data } = await serviceClient().from("institutions").select("id").eq("name_ar", "مستشفى الاختبار");
  expect(data).toEqual([]);
});

test.describe("activity log", () => {
  test.beforeAll(async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      action: "admin_doctor_updated",
      actor_doctor_id: seededIds().admin,
      target_doctor_id: seededIds().laila,
      metadata: { is_visible: true, n: i },
      created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    // Around 1 January in Jerusalem (UTC+2): one person's edit either side
    // of midnight, a schedule, and a CI login.
    const { admin, samer } = seededIds();
    const others = [
      { action: "admin_doctor_updated", actor_doctor_id: admin, target_doctor_id: samer, metadata: {}, created_at: "2025-12-31T21:30:00Z" },
      { action: "admin_doctor_updated", actor_doctor_id: admin, target_doctor_id: samer, metadata: {}, created_at: "2025-12-31T22:30:00Z" },
      { action: "moh_sync_completed", actor_doctor_id: null, target_doctor_id: null, metadata: {}, created_at: "2026-01-01T10:00:00Z" },
      { action: "dev_password_login", actor_doctor_id: admin, target_doctor_id: admin, metadata: { ci_run: "https://github.com/x/y/actions/runs/1" }, created_at: "2026-01-01T10:05:00Z" },
    ];
    const { error } = await serviceClient().from("audit_logs").insert([...rows, ...others]);
    expect(error).toBeNull();
  });
  test.afterAll(async () => {
    await serviceClient().from("audit_logs").delete().lt("created_at", "2026-01-02");
  });

  test("pages through every entry", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(page.getByText(/الصفحة 1 من [2-9]/)).toBeVisible();
    await page.getByRole("link", { name: "التالي" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/الصفحة 2 من/)).toBeVisible();
    await page.getByRole("link", { name: "السابق" }).click();
    await expect(page.getByText(/الصفحة 1 من/)).toBeVisible();
  });

  test("filters by day, people only, event and doctor, and keeps the filter across pages", async ({ page }) => {
    await page.goto("/admin/audit");
    const filters = page.getByRole("form", { name: "تصفية السجل" });
    await filters.getByLabel("من", { exact: true }).fill("2026-01-01");
    await filters.getByLabel("إلى", { exact: true }).fill("2026-01-01");
    await filters.getByRole("button", { name: "تصفية" }).click();
    // 60 + the edit at 00:30 Jerusalem + the schedule + the CI login; not the
    // edit at 23:30 the night before.
    await expect(page.getByText("63 حدثًا تطابق التصفية")).toBeVisible();

    await filters.getByLabel("إخفاء الأحداث التلقائية").check();
    await filters.getByRole("button", { name: "تصفية" }).click();
    await expect(page.getByText("61 حدثًا تطابق التصفية")).toBeVisible();

    await filters.getByLabel("الحدث").selectOption({ label: "تعديل من الإدارة" });
    await filters.getByLabel("الطبيب").fill("ليلى");
    await filters.getByRole("button", { name: "تصفية" }).click();
    await expect(page.getByText("60 حدثًا تطابق التصفية")).toBeVisible();

    await page.getByRole("link", { name: "التالي" }).click();
    await expect(page.getByText("الصفحة 2 من 2")).toBeVisible();
    await expect(filters.getByLabel("الطبيب")).toHaveValue("ليلى");
    await expect(filters.getByLabel("إخفاء الأحداث التلقائية")).toBeChecked();

    await filters.getByRole("link", { name: "مسح" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(page.getByText(/حدثًا في السجل/)).toBeVisible();
  });
});

test.describe("unfinished signups", () => {
  const PHONE = "+972529990001";
  let id: string;
  test.beforeAll(async () => {
    const db = serviceClient();
    await db.from("pending_signups").delete().eq("phone_e164", PHONE);
    const { data, error } = await db
      .from("pending_signups")
      .insert({
        phone_e164: PHONE,
        // Its code expired long ago; the signup stays for the reminder.
        expires_at: new Date(Date.now() - 3_600_000).toISOString(),
        payload: {
          phone_e164: PHONE,
          arabic_first_name: "ناقص",
          arabic_family_name: "التسجيل",
          license_number: "599997",
          license_region: "IL",
          license_verification_status: "not_found",
          specialty_ids: [],
          resume_form: { phone: "0529990001", license_number: "599997", arabic_first_name: "ناقص", arabic_family_name: "التسجيل" },
        },
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    id = data!.id;
  });
  test.afterAll(async () => {
    await serviceClient().from("pending_signups").delete().eq("phone_e164", PHONE);
  });

  test("an admin reminds the doctor, whose link reopens the form filled in", async ({ page, browser }) => {
    await page.goto("/admin/signups");
    await expect(page.getByText("د. ناقص التسجيل")).toBeVisible();

    // The button opens WhatsApp in a new tab; the link it carries is what matters.
    const res = await page.request.post(`/api/admin/pending-signups/${id}`);
    expect(res.status()).toBe(200);
    const text = new URL((await res.json()).whatsapp).searchParams.get("text")!;
    const link = new URL(/https?:\/\/\S+\/signup\?resume=[\w-]+/.exec(text)![0]);

    const visitor = await browser.newContext();
    const p = await visitor.newPage();
    await p.goto(link.pathname + link.search);
    await expect(p.getByText("فتحنا النموذج كما تركته")).toBeVisible();
    await expect(p.getByLabel(/^رقم الترخيص/)).toHaveValue("599997");
    await p.goto("/signup?resume=not-a-real-token-at-all-0000");
    await expect(p.getByText("انتهت صلاحية هذا الرابط")).toBeVisible();
    await visitor.close();

    await page.reload();
    const row = page.getByRole("listitem").filter({ hasText: "ناقص التسجيل" });
    await expect(row.getByText(/ذُكّر/)).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "حذف" }).click();
    await expect(page.getByText("د. ناقص التسجيل")).toHaveCount(0);
  });
});
