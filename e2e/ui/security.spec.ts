// The browser-side protections, checked in a real browser: what an attacker
// who got HTML onto a page could and could not do.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";

test.use({ storageState: stateFile("doctor") });

test("an injected inline script does not run, the site's own scripts do @phone", async ({ page }) => {
  const res = await page.goto("/dashboard");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);

  // The page works: React hydrated and the search answers.
  await page.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("ليلى");
  await expect(page.getByText("ليلى الخطيب").first()).toBeVisible();

  // The classic injection: markup with an inline handler. (Code run through
  // page.evaluate itself is exempt from CSP, as DevTools code is, so the
  // payload has to be markup the page runs on its own.)
  await page.evaluate(() => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="/nope.png" onerror="window.__injected = true">';
    document.body.appendChild(div);
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as { __injected?: boolean }).__injected)).toBeUndefined();
});

test("page scripts cannot read the session", async ({ page, context }) => {
  await page.goto("/dashboard");
  const session = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(session.length).toBeGreaterThan(0);
  for (const c of session) expect(c.httpOnly, c.name).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain("sb-");
});

test("the hardening headers are on every page", async ({ page }) => {
  for (const path of ["/", "/dashboard", "/privacy"]) {
    const h = (await page.goto(path))!.headers();
    expect(h["cross-origin-opener-policy"], path).toBe("same-origin");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
  }
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a look-alike of a public path still needs a session", async ({ page }) => {
    await page.goto("/loginx");
    await expect(page).toHaveURL(/\/login\?next=%2Floginx/);
  });
});

/** Records the Content-Security-Policy violations a page causes. */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as { __csp?: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
}
async function violations(page: Page): Promise<string[]> {
  await page.waitForTimeout(500);
  return page.evaluate(() => (window as { __csp?: string[] }).__csp ?? []);
}

// Zod's Function("") probe was refused on every page that validates in the
// browser, and Lighthouse marked /signup down for it (#168).
test.describe("the site's own code stays within its Content-Security-Policy", () => {
  test("signed out: /, /login, /signup", async ({ browser }) => {
    const page = await browser.newPage({ storageState: { cookies: [], origins: [] } });
    await watchCsp(page);
    for (const path of ["/", "/login", "/signup"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      if (path === "/signup") await page.getByLabel("رقم الهاتف").fill("0521234567");
      expect(await violations(page), path).toEqual([]);
    }
    await page.close();
  });

  test("signed in: the dashboard with a search, and the profile", async ({ page }) => {
    await watchCsp(page);
    await page.goto("/dashboard");
    await page.getByPlaceholder("ابحث عن طبيب أو تخصص").fill("ليلى");
    await expect(page.getByText("ليلى الخطيب").first()).toBeVisible();
    expect(await violations(page), "/dashboard").toEqual([]);
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "ملفي" })).toBeVisible();
    expect(await violations(page), "/profile").toEqual([]);
  });
});
