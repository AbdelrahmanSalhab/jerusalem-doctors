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
  await serviceClient().from("doctor_workplaces").delete().eq("doctor_id", seededIds().samer).eq("workplace_type", "hmo");
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

test("a specialist lists a صندوق مرضى clinic as a workplace", async ({ page }) => {
  // It used to be offered to residents only, so specialists working at one
  // declared themselves residents to list it.
  await page.goto("/profile");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "مكان العمل", exact: true }) });
  await section.getByRole("button", { name: "تعديل" }).click();
  await section.getByRole("button", { name: "+ إضافة صندوق مرضى" }).click();
  await section.getByLabel("اسم مكان العمل").last().fill("كلاليت بيت حنينا");
  await page.getByRole("button", { name: "حفظ التعديلات" }).click();
  await expect(page.getByText("تم حفظ التعديلات.")).toBeVisible();

  const { data } = await serviceClient()
    .from("doctor_workplaces")
    .select("workplace_type")
    .eq("doctor_id", seededIds().samer)
    .eq("name", "كلاليت بيت حنينا");
  expect(data).toEqual([{ workplace_type: "hmo" }]);
  const { data: doctor } = await serviceClient().from("doctors").select("career_stage").eq("id", seededIds().samer).single();
  expect(doctor?.career_stage).toBe("specialist");
});
