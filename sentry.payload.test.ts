// The real Sentry SDK, with our settings and a fake transport, handling a
// request that carries everything personal we know of: what it would send
// must contain none of it. Settings tests prove the options are passed; this
// proves what leaves.

import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRIVATE_DATA_COLLECTION, scrubBreadcrumb, scrubEvent, scrubSpan } from "@/lib/sentryScrub";

const require = createRequire(import.meta.url);
const sent: string[] = [];
let payload = "";

// Built at runtime: Sentry attaches the source lines around a stack frame,
// and a literal here would show up in them (our app's own source carries no
// personal data, so that part of the payload is not what is under test).
const j = (...parts: string[]) => parts.join("");
const PHONE = j("052", "1234567");
const PHONE_INTL = j("9725", "01234567");
const PHONE_LOGGED = j("052", "9998877");
const LICENCE = j("2000", "01");
const NAME = j("Iy", "as");
const NAME_AR = j("إي", "اس");
const COOKIE = j("SECRET", "COOKIE");
const IP = j("203.0", ".113");
const BEARER = j("Bearer ", "abc");
const LOCAL = j("LOCAL", "VAR");

const PERSONAL = [PHONE, PHONE_INTL, PHONE_LOGGED, LICENCE, NAME, encodeURIComponent(NAME_AR), NAME_AR, COOKIE, IP, BEARER, LOCAL];

beforeAll(async () => {
  process.env.NEXT_RUNTIME = "nodejs";
  process.env.NEXT_OTEL_FETCH_DISABLED = "1";
  const Sentry = require("@sentry/nextjs");
  const { createTransport } = require("@sentry/core");
  Sentry.init({
    dsn: "https://key@o0.ingest.sentry.io/0",
    tracesSampleRate: 1,
    dataCollection: PRIVATE_DATA_COLLECTION,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendSpan: scrubSpan,
    traceLifecycle: "stream",
    transport: (opts: unknown) =>
      createTransport(opts, async (req: { body: string | Uint8Array }) => {
        sent.push(typeof req.body === "string" ? req.body : Buffer.from(req.body).toString());
        return { statusCode: 200 };
      }),
  });

  const http = await import("node:http");
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/upstream")) {
      res.setHeader("set-cookie", `sb-access=${COOKIE}`);
      res.end(JSON.stringify({ phone: PHONE }));
      return;
    }
    for await (const _ of req) void _;
    console.error("[audit] write failed", { details: `Failing row contains (${NAME}, ${NAME_AR}, ${LICENCE}, ${PHONE_LOGGED})` });
    const port = (server.address() as { port: number }).port;
    // A PostgREST-style query, as the app's database calls look.
    await (await fetch(`http://127.0.0.1:${port}/upstream?license_number=in.%28${LICENCE}%29&phone_e164=in.%28%2B${PHONE_INTL}%29`, {
      headers: { authorization: BEARER },
    })).text();
    try {
      const secretLocal = `${LOCAL}_${PHONE}`;
      throw new Error(`boom ${secretLocal.length}`);
    } catch (e) {
      Sentry.captureException(e);
    }
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  await fetch(`http://127.0.0.1:${port}/admin?q=${PHONE}&name=${encodeURIComponent(NAME_AR)}`, {
    method: "POST",
    headers: {
      cookie: `sb-access-token=${COOKIE}`,
      "x-forwarded-for": `${IP}.7`,
      "x-vercel-proxied-for": `${IP}.8`,
      "x-real-ip": `${IP}.9`,
      referer: `http://127.0.0.1:${port}/report?license=${LICENCE}&name=${NAME}`,
      "x-custom-name": NAME,
      "content-type": "application/json",
    },
    body: JSON.stringify({ phone: PHONE, arabic_full_name: NAME_AR }),
  });
  await Sentry.flush(5000);
  server.close();
  payload = sent.join("\n");
  if (process.env.SENTRY_PAYLOAD_DUMP) (await import("node:fs")).writeFileSync(process.env.SENTRY_PAYLOAD_DUMP, payload);
}, 30_000);

afterAll(() => {
  delete process.env.NEXT_OTEL_FETCH_DISABLED;
});

describe("what Sentry would send for a request full of personal data", () => {
  it("sends something: the error and the request's spans", () => {
    expect(payload).toContain("boom");
    expect(payload).toContain('"type":"span"');
  });

  it.each(PERSONAL)("contains no %s", (needle) => {
    expect(payload).not.toContain(needle);
  });
});
