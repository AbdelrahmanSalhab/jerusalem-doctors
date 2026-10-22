// What the real app sends to Sentry, browser and server: e2e/env.ts points
// SENTRY_DSN at the stub, which keeps every envelope. None of it may carry a
// doctor's name, phone, licence or email (e2e/sentryPrivacy.ts); the global
// teardown checks the whole run's envelopes the same way.
//
// The browser keeps no click breadcrumbs: Sentry would describe a click by
// the element's selector, attributes included, and the app puts names in
// them (a photo's alt). The test clicks an element named like a doctor and
// throws an error in the page: the error must arrive, the click must not.

import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";
import { personalDataIn, sentEnvelopes as envelopes } from "../sentryPrivacy";

test.use({ storageState: stateFile("doctor") });

test("nothing personal reaches Sentry, even a clicked element's name", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("ليلى");
  await expect(page.getByText("ليلى الخطيب").first()).toBeVisible();
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.setAttribute("aria-label", "ليلى الخطيب");
    b.title = "ليلى الخطيب";
    b.textContent = "probe";
    document.body.append(b);
  });
  await page.getByRole("button", { name: "ليلى الخطيب" }).click();
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("sentry privacy probe");
    });
  });

  // The probe's event arrives, without the click.
  await expect.poll(envelopes, { timeout: 15_000 }).toContain("sentry privacy probe");
  const sent = await envelopes();
  expect(sent).not.toContain("ui.click");

  expect(personalDataIn(sent), "personal data sent to Sentry").toEqual([]);
});
