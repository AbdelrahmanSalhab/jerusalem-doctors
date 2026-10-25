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
//   GET  /github-oidc/jwks          GitHub Actions' signing keys, played by a key
//                                   made at start (GITHUB_OIDC_JWKS_URL in e2e)
//   POST /github-oidc/token         a token signed with it: the body's claims
//                                   over a valid smoke-workflow set
import { createServer } from "node:http";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const REGISTRY = JSON.parse(readFileSync(new URL("./registry.json", import.meta.url), "utf8"));
const PORT = Number(process.env.STUB_PORT ?? 3124);
const sent = [];
const envelopes = [];
const oidc = generateKeyPairSync("rsa", { modulusLength: 2048 });
const OIDC_KID = "e2e";

function oidcToken(overrides) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://token.actions.githubusercontent.com",
    aud: "jerusalem-doctors-smoke",
    iat: now,
    exp: now + 300,
    jti: randomUUID(),
    repository: "AbdelrahmanSalhab/jerusalem-doctors",
    workflow_ref: "AbdelrahmanSalhab/jerusalem-doctors/.github/workflows/smoke.yml@refs/heads/main",
    event_name: "deployment_status",
    run_id: "1",
    runner_environment: "github-hosted",
    ...overrides,
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b64({ alg: "RS256", kid: OIDC_KID })}.${b64(claims)}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), oidc.privateKey).toString("base64url")}`;
}

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
  if (url.pathname === "/github-oidc/jwks") {
    return json(res, { keys: [{ ...oidc.publicKey.export({ format: "jwk" }), kid: OIDC_KID, alg: "RS256", use: "sig" }] });
  }
  if (url.pathname === "/github-oidc/token" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => json(res, { value: oidcToken(body ? JSON.parse(body) : {}) }));
    return;
  }
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
      try {
        envelopes.push((req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw).toString());
      } catch {
        // Kept as received rather than taking the stub (and the SMS tests) down.
        envelopes.push(raw.toString("latin1"));
      }
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
