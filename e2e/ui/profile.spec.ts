import { expect, test } from "../fixtures";
import { seededIds, stateFile } from "../helpers";
import { serviceClient } from "../seed";

test.use({ storageState: stateFile("doctor") });

let original: Record<string, unknown>;
test.beforeAll(async () => {
  const { data } = await serviceClient().from("doctors").select("bio, seeking_work").eq("id", seededIds().samer).single();
  original = data!;
});
test.afterAll(async () => {
  await serviceClient().from("doctors").update(original).eq("id", seededIds().samer);
  await serviceClient().from("doctor_workplaces").delete().eq("doctor_id", seededIds().samer).eq("name", CLINIC);
});

test("a doctor edits their bio and it stays saved @phone", async ({ page }) => {
  await page.goto("/profile");
  // The bio sits in the specialty section, behind its edit button.
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "التخصص", exact: true }) }).getByRole("button", { name: "تعديل" }).click();
  const bio = page.getByPlaceholder(/اختياري: خبرة/);
  await bio.fill("أخصائي قلب، أستقبل التحويلات من الزملاء.");
  await page.getByRole("button", { name: "حفظ التعديلات" }).click();
  await expect(page.getByText("تم حفظ التعديلات.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("أخصائي قلب، أستقبل التحويلات من الزملاء.")).toBeVisible();
});

const CLINIC = "عيادة الطب الباطني في شعفاط";

test("a specialist lists a clinic that belongs to a health fund, and a search for the fund finds it", async ({ page }) => {
  // صندوق مرضى as a workplace is for residents; a specialist's clinic says
  // which fund it belongs to instead.
  await page.goto("/profile");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "مكان العمل", exact: true }) });
  await section.getByRole("button", { name: "تعديل" }).click();
  await expect(section.getByRole("button", { name: "+ إضافة صندوق مرضى" })).toHaveCount(0);
  await section.getByRole("button", { name: "+ إضافة عيادة" }).click();
  await section.getByLabel("اسم مكان العمل").last().fill(CLINIC);
  await section.getByLabel("تابعة لصندوق مرضى (اختياري)").last().selectOption("كلاليت");
  await page.getByRole("button", { name: "حفظ التعديلات" }).click();
  await expect(page.getByText("تم حفظ التعديلات.")).toBeVisible();

  const db = serviceClient();
  const { data: fund } = await db.from("institutions").select("id").eq("name_ar", "كلاليت").single();
  const { data } = await db.from("doctor_workplaces").select("workplace_type, hmo_id").eq("doctor_id", seededIds().samer).eq("name", CLINIC);
  expect(data).toEqual([{ workplace_type: "clinic", hmo_id: fund!.id }]);

  // Searching the fund's name finds the clinic's doctor, with the fund on the card.
  await page.goto("/dashboard");
  await page.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("كلاليت");
  const card = page.getByRole("article").filter({ hasText: "سامر ناصر" });
  await expect(card.getByText("تابعة لـكلاليت")).toBeVisible();
});
