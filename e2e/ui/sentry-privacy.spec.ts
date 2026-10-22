// What the real app sends to Sentry, browser and server, from this whole e2e
// run: e2e/env.ts points SENTRY_DSN at the stub, which keeps every envelope.
// None of it may carry a doctor's name, phone, licence or email.
//
// Here a doctor clicks a colleague's photo, whose alt is the colleague's
// name (Sentry describes clicks by a selector with the alt), and then an
// error is thrown in the page, which sends that click as a breadcrumb.

import { expect, test } from "../fixtures";
import { STUB_URL } from "../env";
import { stateFile } from "../helpers";
import { DOCTORS } from "../seed";

test.use({ storageState: stateFile("doctor") });

const envelopes = async () => (await fetch(`${STUB_URL}/sentry/envelopes`)).text();

test("nothing personal reaches Sentry, even a clicked photo's name", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("ليلى");
  await page.getByRole("img", { name: "ليلى الخطيب" }).first().click();
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("sentry privacy probe");
    });
  });

  // The probe's event, with the click on the photo among its breadcrumbs.
  await expect.poll(envelopes, { timeout: 15_000 }).toContain("sentry privacy probe");
  const sent = await envelopes();
  expect(sent).toContain("ui.click");
  expect(sent).toMatch(/img[^"]*\[alt\]/);

  const personal = DOCTORS.flatMap((d) => [
    `${d.first} ${d.family}`,
    d.phone,
    d.phone.replace("+972", "0"),
    d.license,
    ...(d.email ? [d.email] : []),
  ]);
  for (const value of personal) expect(sent, `Sentry was sent ${value}`).not.toContain(value);
});
