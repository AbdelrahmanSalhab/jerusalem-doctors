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
  // The Sentry privacy test throws one in the page on purpose.
  /sentry privacy probe/,
  // The login tests send a wrong password and a closed account on purpose.
  /^http 401 POST \/api\/login\/password/,
  // Visiting /admin as a doctor is a 404 by design.
  /^http 404 GET \/admin$/,
  /^console\.error Failed to load resource: .* status of 401 .*\[\/api\/login\/password\]$/,
  /^console\.error Failed to load resource: .* status of 404 .*\[\/admin\]$/,
  // password.spec.ts tries a wrong current password on purpose.
  /^(http 400 POST |console\.error Failed to load resource: .* status of 400 .*\[)\/api\/profile\/password/,
  // The photo test uploads a text file named .png on purpose.
  /^(http 415 POST |console\.error Failed to load resource: .* status of 415 .*\[)\/api\/profile\/photo/,
  // next.config.ts optimises https Supabase images; the local stack serves
  // them over http from 127.0.0.1, so the optimiser refuses them here only.
  /^(http 400 GET |console\.error Failed to load resource: .* status of 400 .*\[)\/_next\/image/,
  // The WhatsApp test aborts the wa.me navigation it triggers.
  /^requestfailed .*wa\.me/,
  // Vercel Analytics' script is served by Vercel's edge only; the local
  // server 404s it (or the proxy sends it to /login when signed out).
  /_vercel(\/|%2F)insights(\/|%2F)script\.js/,
  // Turnstile's script in production writes an invisible styled line
  // ("%c%d font-size:0;color:transparent NaN"); the test key does not.
  /^console\.error .* \{challenges\.cloudflare\.com\}$/,
  // Cloudflare's Turnstile frame talks to its parent; harmless off its domain.
  /^console\.warning Failed to execute 'postMessage' .*challenges\.cloudflare\.com/,
  // WebKit logs the same Turnstile message as an error, in some runs only.
  /^console\.error Unable to post message to https:\/\/challenges\.cloudflare\.com\. Recipient has origin /,
  // security.spec.ts injects an inline script to prove the CSP blocks it.
  // (Chrome's wording, then WebKit's.)
  /^console\.error Executing inline event handler violates the following Content Security Policy/,
  /^console\.error Refused to execute a script for an inline event handler because 'unsafe-inline' does not appear in the script-src/,
  /^(http 404 GET |console\.error Failed to load resource: .* status of 404 .*\[)\/nope\.png/,
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
          // "Failed to load resource" names no URL; the message's location does.
          // Anything written by another site's script is tagged with its host.
          const loc = m.location().url;
          const own = loc.startsWith(new URL(page.url() || "http://x").origin);
          const where = m.text().startsWith("Failed to load resource")
            ? ` [${loc.replace(/^https?:\/\/[^/]+/, "")}]`
            : loc && !own && /^https?:/.test(loc)
              ? ` {${new URL(loc).host}}`
              : "";
          issues.push({ kind: `console.${m.type()}` as Issue["kind"], text: m.text().slice(0, 300) + where, url: here() });
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
