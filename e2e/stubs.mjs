// Stand-ins for the outside services the app calls, so tests never depend on
// a government API or spend SMS credit:
//
//   /api/3/action/datastore_search  data.gov.il's CKAN registry (lib/moh/client.ts),
//                                   serving e2e/registry.json; supports
//                                   `filters`, `q`, `limit`, `offset`
//   POST /sms4free/send             SMS4FREE's send API (lib/otp/sms4free.ts);
//                                   answers {status: 1} and keeps the message
//   GET  /sms4free/messages?to=05…  what was "sent" to a number, newest last
//   POST /api/<project>/envelope/   Sentry's ingest: the app's server and
//                                   browser send here in e2e (SENTRY_DSN), so a
//                                   test can read exactly what would leave
//   GET  /sentry/envelopes          everything received so far, as text
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const REGISTRY = JSON.parse(readFileSync(new URL("./registry.json", import.meta.url), "utf8"));
const PORT = Number(process.env.STUB_PORT ?? 3124);
const sent = [];
const envelopes = [];

const json = (res, body, status = 200) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

function registry(url, res) {
  let rows = REGISTRY;
  const filters = url.searchParams.get("filters");
  if (filters) {
    const f = JSON.parse(filters);
    // A list matches any of its values, as CKAN does.
    rows = rows.filter((r) => Object.entries(f).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
  }
  const q = url.searchParams.get("q");
  if (q) rows = rows.filter((r) => Object.values(r).some((v) => String(v).includes(q)));
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  json(res, { success: true, result: { records: rows.slice(offset, offset + limit), total: rows.length } });
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/health") return res.end("ok");
  if (url.pathname === "/api/3/action/datastore_search") return registry(url, res);
  if (url.pathname === "/sms4free/send" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { recipient, msg, sender } = JSON.parse(body);
      sent.push({ to: recipient, msg, sender, at: Date.now() });
      json(res, { status: 1, message: "ok" });
    });
    return;
  }
  if (/^\/api\/\d+\/envelope\/?$/.test(url.pathname) && req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      envelopes.push((req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw).toString());
      // The browser posts cross-origin.
      res.setHeader("Access-Control-Allow-Origin", "*");
      json(res, {});
    });
    return;
  }
  if (url.pathname === "/sentry/envelopes") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(envelopes.join("\n"));
  }
  if (url.pathname === "/sms4free/messages") {
    return json(res, sent.filter((m) => m.to === url.searchParams.get("to")));
  }
  res.statusCode = 404;
  res.end();
}).listen(PORT, "127.0.0.1");
