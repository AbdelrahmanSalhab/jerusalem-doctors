// Signs the smoke run in once, as the CI account, with a token GitHub issues
// to this workflow (POST /api/login/ci, lib/auth/githubOidc.ts): no password
// exists to store or leak. Saves the session for production.spec.ts, and
// smoke.teardown.ts signs it out when the run ends. Outside GitHub Actions
// there is no token, and the signed-in checks are skipped.

import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { CI_AUDIENCE } from "../../lib/auth/githubOidc";

/** production.spec.ts and smoke.teardown.ts read it from the same path (a
 *  test file cannot import another). */
const STATE = join(__dirname, "..", ".results", "smoke-session.json");

// GitHub sets these in a job with `permissions: id-token: write`.
const TOKEN_URL = process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "";
const TOKEN_AUTH = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? "";
const RUN = process.env.CI_RUN_URL ?? "";

test("sign in as the CI account", async ({ page, context, baseURL }) => {
  test.skip(!TOKEN_URL || !TOKEN_AUTH || !RUN, "only in GitHub Actions, with id-token: write");
  // Marked as a test in the activity log (lib/ciRun.ts).
  await context.route(`${baseURL}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-ci-run": RUN } }),
  );
  const issued = await fetch(`${TOKEN_URL}&audience=${CI_AUDIENCE}`, { headers: { Authorization: `bearer ${TOKEN_AUTH}` } });
  expect(issued.ok, "GitHub issued no token (does the job have id-token: write?)").toBe(true);
  const { value } = await issued.json();

  const signIn = await page.request.post("/api/login/ci", { data: { token: value } });
  expect(signIn.status(), "POST /api/login/ci (is CI_LOGIN_EMAIL set on Vercel?)").toBe(200);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await context.storageState({ path: STATE });
});
