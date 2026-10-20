// Integration and browser tests against the real built app, a local Supabase
// (supabase start) and a local Redis REST (e2e/docker-compose.yml). See
// e2e/README.md for running them.

import { defineConfig, devices } from "@playwright/test";
import { appEnv, BASE_URL, PORT, STUB_URL } from "./e2e/env";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  // Test artifacts; server.log and diagnostics sit beside it in e2e/.results.
  outputDir: "./e2e/.results/tests",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  // The tests that change data run one at a time, as a chain of projects
  // (db -> api -> desktop -> phone, one worker each); the read-only page sweep
  // runs alongside them on the remaining workers.
  workers: 3,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: CI ? [["github"], ["html", { open: "never", outputFolder: "e2e/.report" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    locale: "ar",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "db", testMatch: /db\/.*\.spec\.ts/, workers: 1 },
    { name: "api", testMatch: /api\/.*\.spec\.ts/, workers: 1, dependencies: ["db"] },
    {
      name: "desktop",
      testMatch: /ui\/.*\.spec\.ts/,
      testIgnore: /pages\.spec\.ts/,
      workers: 1,
      dependencies: ["api"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Only reads: every page as each kind of user. Safe to run in parallel,
      // and next to the chain above.
      name: "sweep",
      testMatch: /ui\/pages\.spec\.ts/,
      fullyParallel: true,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "phone",
      workers: 1,
      dependencies: ["desktop"],
      testMatch: /ui\/.*\.spec\.ts/,
      grep: /@phone/,
      // Real WebKit in CI (Safari's engine, where the cut-off dropdown bug
      // lived). Locally WebKit needs system libraries most machines lack, so
      // Chromium at the iPhone's size stands in.
      use: { ...devices["iPhone 13"], ...(CI ? {} : { browserName: "chromium" as const }) },
    },
  ],
  webServer: [
    {
      command: "node e2e/stubs.mjs",
      url: `${STUB_URL}/health`,
      reuseExistingServer: !CI,
    },
    {
      // The production build, as Vercel runs it, with the local stack's env.
      // Server output goes to a file the teardown summarises.
      // CI builds in its own step while Supabase starts (E2E_PREBUILT=1).
      command: `${process.env.E2E_PREBUILT ? "" : "npm run build && "}mkdir -p e2e/.results && npx next start -p ${PORT} > e2e/.results/server.log 2>&1`,
      url: `${BASE_URL}/login`,
      env: appEnv(),
      timeout: 300_000,
      reuseExistingServer: !CI,
      stdout: "ignore",
    },
  ],
});
