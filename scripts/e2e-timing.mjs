// Where the e2e run's time went, as a Markdown table for the job summary:
// per project (how long it was busy, from its first test starting to its last
// one ending), the slowest tests, and the flaky ones: tests that failed and
// then passed on a retry, which the run counts as green. Reads Playwright's JSON report; prints
// nothing when there is none (a run that died before the tests).
//
//   node scripts/e2e-timing.mjs [e2e/.results/report.json] >> "$GITHUB_STEP_SUMMARY"

import { existsSync, readFileSync } from "node:fs";

const file = process.argv[2] ?? "e2e/.results/report.json";
if (!existsSync(file)) process.exit(0);
const report = JSON.parse(readFileSync(file, "utf8"));

const projects = new Map();
const tests = [];
const flaky = [];
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      if (t.status === "flaky") flaky.push(`${t.projectName}: ${spec.file}: ${spec.title}`);
      for (const r of t.results) {
        const start = Date.parse(r.startTime);
        const p = projects.get(t.projectName) ?? { tests: 0, busy: 0, first: Infinity, last: 0, retries: 0 };
        p.tests += 1;
        p.busy += r.duration;
        p.first = Math.min(p.first, start);
        p.last = Math.max(p.last, start + r.duration);
        p.retries += r.retry > 0 ? 1 : 0;
        projects.set(t.projectName, p);
        tests.push({ ms: r.duration, project: t.projectName, file: spec.file, title: spec.title });
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child);
};
report.suites.forEach(walk);

const s = (ms) => (ms / 1000).toFixed(1);
const lines = ["### e2e timing", "", "| project | results | span | busy | retries |", "|---|---:|---:|---:|---:|"];
for (const [name, p] of [...projects].sort((a, b) => a[1].first - b[1].first)) {
  lines.push(`| ${name} | ${p.tests} | ${s(p.last - p.first)} s | ${s(p.busy)} s | ${p.retries} |`);
}
lines.push("", "Slowest tests:", "", "| s | project | test |", "|---:|---|---|");
for (const t of tests.sort((a, b) => b.ms - a.ms).slice(0, 10)) {
  lines.push(`| ${s(t.ms)} | ${t.project} | ${t.file}: ${t.title.replaceAll("|", "\\|")} |`);
}
if (flaky.length > 0) {
  lines.push("", `### Flaky: passed only on a retry (${flaky.length})`, "");
  for (const f of flaky) lines.push(`- ${f.replaceAll("|", "\\|")}`);
  // A line GitHub shows on the run page, not only in the summary tab.
  console.error(`::warning title=Flaky e2e tests::${flaky.length} passed only on a retry; see the job summary.`);
}
console.log(lines.join("\n"));
