// Times the app's main paths against a deployment, as a signed-in admin,
// and prints a Markdown table: median, 95th percentile and fastest of
// connection setup, time to first byte and total, plus response size and the
// server's own time where the response reports one (Server-Timing).
//
// Run it before and after a performance change, from the same place, and
// keep both tables in docs/perf/. Uses curl for the per-phase timings.
//
//   PERF_EMAIL=... PERF_PASSWORD=... node --experimental-strip-types scripts/perf/measure.ts > out.md
//
// Optional: PERF_BASE (default production), PERF_RUNS (default 15).
// Searches are paced to stay under the search rate limit (30 a minute).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.PERF_BASE ?? "https://jerusalem-doctors.vercel.app";
const RUNS = Number(process.env.PERF_RUNS ?? 15);
const EMAIL = process.env.PERF_EMAIL;
const PASSWORD = process.env.PERF_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("PERF_EMAIL and PERF_PASSWORD are required");

interface Path {
  group: string;
  path: string;
  /** Seconds to wait after each request (rate-limited routes). */
  pace?: number;
}

const enc = encodeURIComponent;
const PATHS: Path[] = [
  { group: "public", path: "/" },
  { group: "public", path: "/login" },
  { group: "public", path: "/signup" },
  { group: "public", path: "/privacy" },
  { group: "public", path: "/health" },
  { group: "signed in", path: "/dashboard" },
  { group: "signed in", path: "/profile" },
  { group: "admin", path: "/admin" },
  { group: "admin", path: "/admin/stats" },
  { group: "admin", path: "/admin/audit" },
  { group: "admin", path: "/admin/audit?action=alert" },
  { group: "search API", path: `/api/search?q=${enc("محمد")}`, pace: 2.2 },
  { group: "search API", path: `/api/search?q=${enc("الباطنية")}`, pace: 2.2 },
  { group: "search API", path: `/api/search?q=${enc("هداسا")}`, pace: 2.2 },
  { group: "search API", path: `/api/search?q=${enc("ا")}`, pace: 2.2 },
];

const FORMAT = [
  "%{http_code}",
  "%{time_connect}",
  "%{time_appconnect}",
  "%{time_starttransfer}",
  "%{time_total}",
  "%{size_download}",
].join(" ");

interface Sample {
  status: number;
  connect: number;
  tls: number;
  ttfb: number;
  total: number;
  bytes: number;
  server: number | null;
}

function curl(jar: string, path: string): Sample {
  const out = execFileSync(
    "curl",
    ["-s", "-o", "/dev/null", "-D", "-", "-b", jar, "-c", jar, "-w", `\n@@ ${FORMAT}`, `${BASE}${path}`],
    { encoding: "utf8" },
  );
  const [headers, metrics] = out.split("\n@@ ");
  const [status, connect, tls, ttfb, total, bytes] = metrics.trim().split(" ").map(Number);
  const timing = /^server-timing:.*?dur=([\d.]+)/im.exec(headers);
  return { status, connect, tls, ttfb, total, bytes, server: timing ? Number(timing[1]) / 1000 : null };
}

function signIn(jar: string): void {
  const res = execFileSync(
    "curl",
    [
      "-s", "-o", "/dev/null", "-w", "%{http_code}", "-c", jar,
      "-H", "Content-Type: application/json",
      "-d", JSON.stringify({ email: EMAIL, password: PASSWORD }),
      `${BASE}/api/login/password`,
    ],
    { encoding: "utf8" },
  );
  if (res.trim() !== "200") throw new Error(`sign-in failed: HTTP ${res}`);
}

const sleep = (s: number) => execFileSync("sleep", [String(s)]);

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
const ms = (s: number) => `${Math.round(s * 1000)}`;

function row(p: Path, samples: Sample[]): string {
  const col = (pick: (x: Sample) => number) => {
    const xs = samples.map(pick);
    return `${ms(quantile(xs, 0.5))} / ${ms(quantile(xs, 0.95))} / ${ms(Math.min(...xs))}`;
  };
  const servers = samples.map((x) => x.server).filter((x): x is number => x !== null);
  const statuses = [...new Set(samples.map((x) => x.status))].join(",");
  return [
    p.group,
    `\`${decodeURIComponent(p.path)}\``,
    statuses,
    col((x) => x.connect),
    col((x) => x.ttfb),
    col((x) => x.total),
    servers.length ? `${ms(quantile(servers, 0.5))} / ${ms(quantile(servers, 0.95))}` : "-",
    `${Math.round(quantile(samples.map((x) => x.bytes), 0.5) / 1024)} KB`,
  ].join(" | ");
}

const dir = mkdtempSync(join(tmpdir(), "perf-"));
const jar = join(dir, "cookies");
try {
  signIn(jar);
  const lines = [
    `Measured ${new Date().toISOString()} against ${BASE}, ${RUNS} runs per path after one warm-up.`,
    "Times in ms as median / 95th percentile / fastest. Connect is the TCP handshake (network distance);",
    "TTFB is time to first byte (network + server); Server is the server's own Server-Timing, where reported.",
    "",
    "| Group | Path | Status | Connect | TTFB | Total | Server | Size |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const p of PATHS) {
    curl(jar, p.path); // warm-up, not counted
    if (p.pace) sleep(p.pace);
    const samples: Sample[] = [];
    for (let i = 0; i < RUNS; i++) {
      samples.push(curl(jar, p.path));
      if (p.pace) sleep(p.pace);
    }
    lines.push(`| ${row(p, samples)} |`);
    process.stderr.write(`${p.path} done\n`);
  }
  console.log(lines.join("\n"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
