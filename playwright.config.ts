// Integration and browser tests against the real built app, a local Supabase
// (supabase start) and a local Redis REST (e2e/docker-compose.yml). See
// e2e/README.md for running them.

import { defineConfig, devices } from "@playwright/test";
import { appEnv, BASE_URL, MOH_STUB_PORT, PORT } from "./e2e/env";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  // Test artifacts; server.log and diagnostics sit beside it in e2e/.results.
  outputDir: "./e2e/.results/tests",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  // One worker: the tests share one seeded database and change it.
  workers: 1,
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
    { name: "db", testMatch: /db\/.*\.spec\.ts/ },
    { name: "api", testMatch: /api\/.*\.spec\.ts/ },
    { name: "desktop", testMatch: /ui\/.*\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "phone",
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
      command: "node e2e/mohStub.mjs",
      url: `http://127.0.0.1:${MOH_STUB_PORT}/health`,
      reuseExistingServer: !CI,
    },
    {
      // The production build, as Vercel runs it, with the local stack's env.
      // Server output goes to a file the teardown summarises.
      command: `npm run build && mkdir -p e2e/.results && npx next start -p ${PORT} > e2e/.results/server.log 2>&1`,
      url: `${BASE_URL}/login`,
      env: appEnv(),
      timeout: 300_000,
      reuseExistingServer: !CI,
      stdout: "ignore",
    },
  ],
});
