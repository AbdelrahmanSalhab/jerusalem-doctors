// Lighthouse (mobile) on the signed-in dashboard, with the smoke run's CI
// session (smoke.setup.ts), before smoke.teardown.ts signs it out (#178).
//
// Warn-only while we learn the baseline: it never fails the run. The report
// holds screenshots of doctors' names and numbers and the repository is
// public, so it is read in memory and only the scores reach the job summary.
// Its requests carry x-ci-run, so nothing it does is counted in the stats.

import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, test } from "@playwright/test";

const STATE = join(__dirname, "..", ".results", "smoke-session.json");
const RUN = process.env.CI_RUN_URL ?? "";
const PORT = 9333;
const PAGES = ["/dashboard"];
// The bars the public pages must meet (lighthouserc.json): below them, warn.
const BARS: Record<string, number> = { performance: 0.85, accessibility: 0.98, "best-practices": 0.95 };
const METRICS = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift"];

type Report = {
  finalDisplayedUrl: string;
  categories: Record<string, { score: number | null }>;
  audits: Record<string, { displayValue?: string }>;
};

test.skip(!process.env.SMOKE_LIGHTHOUSE, "SMOKE_LIGHTHOUSE is off (scheduled runs skip Lighthouse)");
test.skip(!RUN, "CI_RUN_URL is required");

/** Lighthouse 12 (what @lhci/cli 0.15.1 runs) against the Chrome on PORT;
 *  --disable-storage-reset keeps the session cookies. */
async function audit(url: string): Promise<Report> {
  const { stdout } = await promisify(execFile)(
    "npx",
    [
      "-y", "lighthouse@12.6.1", url,
      `--port=${PORT}`, "--disable-storage-reset", "--quiet",
      `--extra-headers=${JSON.stringify({ "x-ci-run": RUN })}`,
      "--only-categories=performance,accessibility,best-practices",
      "--output=json", "--output-path=stdout",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as Report;
}

function summaryRow(path: string, r: Report): string {
  const score = (k: string) => Math.round((r.categories[k]?.score ?? 0) * 100);
  const metric = (k: string) => r.audits[k]?.displayValue ?? "-";
  return `| ${path} | ${Object.keys(BARS).map(score).join(" | ")} | ${METRICS.map(metric).join(" | ")} |`;
}

test("Lighthouse on the signed-in dashboard (warn-only)", async ({ baseURL }) => {
  test.skip(!existsSync(STATE), "nobody signed in");
  test.setTimeout(240_000);

  const profile = mkdtempSync(join(tmpdir(), "lh-"));
  const browser = await chromium.launchPersistentContext(profile, {
    args: [`--remote-debugging-port=${PORT}`],
  });
  const rows: string[] = [];
  try {
    await browser.addCookies(JSON.parse(readFileSync(STATE, "utf8")).cookies);
    for (const path of PAGES) {
      try {
        const report = await audit(`${baseURL}${path}`);
        // Sent to /login: that page's scores would pass for the dashboard's.
        if (new URL(report.finalDisplayedUrl).pathname !== path) throw new Error(`ended on ${report.finalDisplayedUrl}`);
        rows.push(summaryRow(path, report));
        for (const [k, bar] of Object.entries(BARS)) {
          const s = report.categories[k]?.score ?? 0;
          if (s < bar) test.info().annotations.push({ type: "warning", description: `${path} ${k} ${s} < ${bar}` });
        }
      } catch (e) {
        // Only the message: the report on stdout is never printed.
        rows.push(`| ${path} | Lighthouse failed: ${(e as Error).message.split("\n")[0]} |`);
      }
    }
  } finally {
    await browser.close();
    rmSync(profile, { recursive: true, force: true });
  }

  const table = [
    "### Lighthouse, signed in (mobile, warn-only)",
    `| Page | ${Object.keys(BARS).join(" | ")} | FCP | LCP | TBT | CLS |`,
    `|---|${"---|".repeat(Object.keys(BARS).length + METRICS.length)}`,
    ...rows,
    "",
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
  else console.info(table);
});
