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
