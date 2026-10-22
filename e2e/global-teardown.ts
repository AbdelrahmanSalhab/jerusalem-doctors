// After the run: one summary of what the browser and the app server reported,
// grouped and counted, in e2e/.results/diagnostics.md. In CI it also goes to
// the job summary, so warnings are visible without opening artifacts.

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIAG_DIR, isExpected, type Issue } from "./fixtures";
import { SERVER_LOG } from "./helpers";
import { personalDataIn, sentEnvelopes } from "./sentryPrivacy";

/** Lines in the server log worth a look. */
const SERVER_NOISE = /error|warn|⚠|unhandled|failed/i;

export default async function globalTeardown() {
  // Everything the app sent to Sentry during the whole run, browser and
  // server, after every test (e2e/sentryPrivacy.ts). Fails the run.
  const leaks = personalDataIn(await sentEnvelopes().catch(() => ""));
  if (leaks.length > 0) throw new Error(`Personal data reached Sentry during the e2e run: ${leaks.join(", ")}`);

  const groups = new Map<string, { count: number; tests: Set<string>; pages: Set<string> }>();
  /** Known noise (fixtures.ts EXPECTED), counted but not listed. */
  let expected = 0;
  if (existsSync(DIAG_DIR)) {
    for (const f of readdirSync(DIAG_DIR).filter((n) => n.endsWith(".json"))) {
      const { test, issues } = JSON.parse(readFileSync(path.join(DIAG_DIR, f), "utf8")) as { test: string; issues: Issue[] };
      for (const i of issues) {
        if (isExpected(i)) {
          expected++;
          continue;
        }
        // Ids and numbers vary between runs; group by the message's shape.
        const key = `${i.kind}: ${i.text.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`;
        const g = groups.get(key) ?? { count: 0, tests: new Set(), pages: new Set() };
        g.count++;
        g.tests.add(test);
        g.pages.add(i.url);
        groups.set(key, g);
      }
    }
  }
  const server = existsSync(SERVER_LOG)
    ? readFileSync(SERVER_LOG, "utf8").split("\n").filter((l) => SERVER_NOISE.test(l))
    : [];
  const serverGroups = new Map<string, number>();
  for (const l of server) serverGroups.set(l.slice(0, 240), (serverGroups.get(l.slice(0, 240)) ?? 0) + 1);

  const lines = ["## Browser and server diagnostics", ""];
  if (groups.size === 0 && serverGroups.size === 0) lines.push("Nothing unexpected reported.");
  lines.push("", `${expected} expected item(s) hidden (see EXPECTED in e2e/fixtures.ts).`, "");
  if (groups.size > 0) {
    lines.push("| Count | Browser | Pages | Tests |", "|---|---|---|---|");
    for (const [k, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
      lines.push(`| ${g.count} | \`${k.replace(/\|/g, "\\|")}\` | ${[...g.pages].slice(0, 3).join(", ")} | ${g.tests.size} |`);
    }
    lines.push("");
  }
  if (serverGroups.size > 0) {
    lines.push("| Count | Server log |", "|---|---|");
    for (const [l, n] of [...serverGroups].sort((a, b) => b[1] - a[1])) lines.push(`| ${n} | \`${l.replace(/\|/g, "\\|")}\` |`);
  }
  const md = lines.join("\n") + "\n";
  writeFileSync(path.join(DIAG_DIR, "..", "diagnostics.md"), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
