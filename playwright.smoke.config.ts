// Read-only checks against production (.github/workflows/smoke.yml). Signs
// in as the CI account with GitHub's token (/api/login/ci); every same-origin request
// carries x-ci-run so the activity log marks it as a test and its searches
// stay out of the stats (lib/ciRun.ts). Changes nothing.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/smoke",
  outputDir: "./e2e/.results/smoke",
  workers: 1,
  retries: 1,
  timeout: 45_000,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? "https://jerusalem-doctors.vercel.app",
    locale: "ar",
    // No traces, screenshots or videos: they record what is typed (the smoke
    // account's password), the session cookies, and admin pages with doctors'
    // details, and this repository is public. The job log's error lines are
    // what a failure leaves.
    trace: "off",
    screenshot: "off",
    video: "off",
    ...devices["Desktop Chrome"],
  },
  // Sign in once (smoke.setup.ts), then run the checks with that session.
  projects: [
    // No retry: a refused sign-in retried is one more attempt against the limit.
    { name: "setup", testMatch: /smoke\.setup\.ts/, retries: 0, teardown: "teardown" },
    { name: "teardown", testMatch: /smoke\.teardown\.ts/, retries: 0 },
    { name: "smoke", testMatch: /production\.spec\.ts/, dependencies: ["setup"] },
  ],
});
