// Production, read-only. A failure here means the live site is broken for
// real users, or something in front of it (Vercel's firewall) is blocking
// people or the services the site depends on.

import { join } from "node:path";
import { expect, test } from "../fixtures";

const EMAIL = process.env.SMOKE_EMAIL ?? "";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "";
const RUN = process.env.CI_RUN_URL ?? "";

test.skip(!EMAIL || !PASSWORD || !RUN, "SMOKE_EMAIL, SMOKE_PASSWORD and CI_RUN_URL are required");

test.beforeEach(async ({ context, baseURL }) => {
  // Same-origin only: a custom header on cross-origin fetches would trigger
  // CORS preflights at Cloudflare and Supabase.
  await context.route(`${baseURL}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-ci-run": RUN } }),
  );
});

test("public pages load, with the security headers", async ({ page }) => {
  for (const path of ["/", "/login", "/signup", "/privacy"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    expect(res?.headers()["x-vercel-mitigated"], `${path} hit the Vercel checkpoint`).toBeUndefined();
  }
  const headers = (await page.request.get("/")).headers();
  expect(headers["content-security-policy"]).toBeTruthy();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["strict-transport-security"]).toBeTruthy();
});

test("the services the site depends on can reach it", async ({ request }) => {
  // Supabase sends every login code through this hook, and Vercel cron runs
  // the nightly jobs. An unsigned call must reach the app and be refused by
  // it (401 JSON), not be stopped by a firewall challenge in front of it.
  for (const [method, path] of [["POST", "/api/auth/hooks/send-otp"], ["GET", "/api/cron/sync-moh"]] as const) {
    const res = await request.fetch(path, { method, data: method === "POST" ? {} : undefined, maxRedirects: 0 });
    expect(res.headers()["x-vercel-mitigated"], `${path} is challenged by the Vercel firewall`).toBeUndefined();
    expect(res.status(), path).toBe(401);
    expect(res.headers()["content-type"], path).toContain("application/json");
  }
});

// Signed in once per run by smoke.setup.ts, through the real /login/dev
// form, and the session shared by the tests below.
const STATE = join(__dirname, "..", ".results", "smoke-session.json");
test.describe("signed in as an admin", () => {
  test.use({ storageState: STATE });

  test("searches, and opens the admin screens", async ({ page }) => {
    await page.goto("/dashboard");
    const count = page.getByText(/\d+ (أطباء|طبيبًا|طبيب) في الدليل/);
    await expect(count).toBeVisible();

    const searched = page.waitForResponse((r) => r.url().includes("/api/search"));
    await page.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("د");
    const res = await searched;
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThan(0);
    // Never in a search response (#83).
    expect(JSON.stringify(body)).not.toContain("license_number");

    for (const path of ["/admin", "/admin/stats", "/admin/audit"]) {
      const r = await page.goto(path);
      expect(r?.status(), path).toBe(200);
    }
    await expect(page.getByText("اختبار آلي (CI)").first()).toBeVisible();
  });

  test("the registry synced successfully in the last 36 hours", async ({ page }) => {
    // Signup and the admin licence check read the nightly copy of the Ministry
    // of Health registry. data.gov.il refuses many networks (CI included), so
    // the check reads what production itself recorded rather than calling it.
    // Only the sync events, so a busy day cannot push them off the first page.
    await page.goto("/admin/audit?action=moh_sync_completed");
    const rows = await page.locator("summary").allInnerTexts();
    const synced = rows
      .filter((r) => r.includes("مزامنة سجل وزارة الصحة") && !r.includes("فشل"))
      .map((r) => r.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/))
      .filter((m): m is RegExpMatchArray => !!m)
      // Jerusalem time is UTC+2 or +3; +3 keeps the age an upper bound.
      .map(([, d, mo, y, h, mi]) => Date.UTC(+y, +mo - 1, +d, +h - 3, +mi));
    expect(synced.length, "no successful registry sync on the log's first page").toBeGreaterThan(0);
    const hours = (Date.now() - Math.max(...synced)) / 3_600_000;
    expect(hours, `last successful registry sync was ${hours.toFixed(0)} hours ago`).toBeLessThan(36);
  });
});
