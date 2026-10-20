// The `test` every browser spec imports. Besides the usual fixtures it records
// what the browser complained about during the test: console errors and
// warnings, uncaught page errors, failed requests and 4xx/5xx responses. They
// are written to e2e/.results/diagnostics and summarised after the run
// (global-teardown.ts); an uncaught page error or console error fails the test
// unless it is listed in EXPECTED.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

export interface Issue {
  kind: "console.error" | "console.warning" | "pageerror" | "requestfailed" | "http";
  text: string;
  url: string;
}

export const DIAG_DIR = path.join(__dirname, ".results", "diagnostics");

/** Noise a test may produce on purpose, matched against kind + text. */
const EXPECTED: RegExp[] = [
  // The login tests send a wrong password and a closed account on purpose.
  /^http 401 POST \/api\/login\/password/,
  // Visiting /admin as a doctor is a 404 by design.
  /^http 404 GET \/admin$/,
  /^console\.error Failed to load resource: the server responded with a status of (401|404)/,
  // The WhatsApp test aborts the wa.me navigation it triggers.
  /^requestfailed .*wa\.me/,
  // Vercel Analytics' script is served by Vercel's edge only; the local
  // server 404s it (or the proxy sends it to /login when signed out).
  /_vercel(\/|%2F)insights(\/|%2F)script\.js/,
  // Cloudflare's Turnstile frame talks to its parent; harmless off its domain.
  /^console\.warning Failed to execute 'postMessage' .*challenges\.cloudflare\.com/,
  // Next aborts in-flight prefetches when a test navigates on.
  /^requestfailed GET \S+[?&]_rsc=\S+ net::ERR_ABORTED/,
];

export const isExpected = (i: Issue) => EXPECTED.some((re) => re.test(`${i.kind} ${i.text}`));

export const test = base.extend<{ diagnostics: Issue[] }>({
  diagnostics: [
    async ({ page }, use, testInfo) => {
      const issues: Issue[] = [];
      const here = () => page.url().replace(/^https?:\/\/[^/]+/, "");
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") {
          issues.push({ kind: `console.${m.type()}` as Issue["kind"], text: m.text().slice(0, 300), url: here() });
        }
      });
      page.on("pageerror", (e) => issues.push({ kind: "pageerror", text: String(e).slice(0, 300), url: here() }));
      page.on("requestfailed", (r) => {
        issues.push({ kind: "requestfailed", text: `${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`, url: here() });
      });
      page.on("response", (r) => {
        if (r.status() < 400) return;
        const u = new URL(r.url());
        issues.push({ kind: "http", text: `${r.status()} ${r.request().method()} ${u.pathname}`, url: here() });
      });

      await use(issues);

      if (issues.length > 0) {
        mkdirSync(DIAG_DIR, { recursive: true });
        const name = `${testInfo.project.name}--${testInfo.titlePath.slice(1).join(" - ")}`.replace(/[^\w؀-ۿ-]+/g, "_");
        writeFileSync(path.join(DIAG_DIR, `${name}.json`), JSON.stringify({ test: testInfo.titlePath.join(" › "), project: testInfo.project.name, issues }, null, 2));
      }
      const fatal = issues.filter((i) => (i.kind === "pageerror" || i.kind === "console.error") && !isExpected(i));
      expect(fatal, "the browser reported errors during this test").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
