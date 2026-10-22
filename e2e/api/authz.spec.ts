// Who may call what. Every API route the app ships is listed in POLICY, and
// every one is called as each kind of user against the running app. A new
// route that is not in POLICY fails the first test, so it cannot ship without
// someone deciding who may call it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { ANON_KEY, BASE_URL, CRON_SECRET, STUB_URL, SUPABASE_URL, type Role } from "../env";
import { flushRateLimits } from "../global-setup";
import { stateFile } from "../helpers";
import { createDoctor } from "../seed";

type Policy =
  /** Signed-in admins only; everyone else 401. */
  | "admin"
  /** Any signed-in open account (pending doctors can search by design). */
  | "doctor"
  /** No session needed: signup, login, the institutions list. */
  | "public"
  /** Vercel cron, with CRON_SECRET. */
  | "cron"
  /** Supabase Auth's signed webhook. */
  | "hook"
  /** Open to all, but only with valid credentials: an empty body is 401. */
  | "credentials";

const POLICY: Record<string, Policy> = {
  "POST /api/admin/doctors/[id]/license/check": "admin",
  "POST /api/admin/doctors/[id]/license/save": "admin",
  "PATCH /api/admin/doctors/[id]": "admin",
  "POST /api/admin/doctors/[id]/photo": "admin",
  "DELETE /api/admin/doctors/[id]/photo": "admin",
  "PATCH /api/admin/doctors/[id]/profile": "admin",
  "DELETE /api/admin/doctors/[id]": "admin",
  "POST /api/admin/pending-signups/[id]": "admin",
  "DELETE /api/admin/pending-signups/[id]": "admin",
  "PATCH /api/admin/institutions/[id]": "admin",
  "PATCH /api/admin/number-requests/[id]": "admin",
  "DELETE /api/admin/institutions/[id]": "admin",
  "POST /api/admin/institutions": "admin",
  "PATCH /api/admin/specialties/[id]": "admin",
  "POST /api/admin/specialties": "admin",
  "POST /api/auth/hooks/send-otp": "hook",
  "POST /api/auth/logout": "public",
  "GET /api/cron/institutions": "cron",
  "GET /api/cron/metrics": "cron",
  "GET /api/cron/sms-balance": "cron",
  "GET /api/cron/sync-moh": "cron",
  "GET /api/institutions": "public",
  "POST /api/login/password": "credentials",
  "POST /api/login/resend": "public",
  "POST /api/login/start": "public",
  "POST /api/login/verify": "public",
  "POST /api/profile/delete-request": "doctor",
  "POST /api/profile/photo": "doctor",
  "PATCH /api/profile": "doctor",
  "POST /api/number-requests": "doctor",
  "GET /api/search": "doctor",
  "POST /api/signup/check-license": "public",
  "POST /api/signup/resend": "public",
  "POST /api/signup/start": "public",
  "POST /api/signup/verify": "public",
  "POST /api/usage/contact": "doctor",
};

/** Calls that would change the seeded accounts if they got through. */
const DESTRUCTIVE = new Set(["POST /api/profile/delete-request", "POST /api/auth/logout"]);

const API_DIR = path.join(__dirname, "../../app/api");

function shippedRoutes(dir = API_DIR): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return shippedRoutes(full);
    if (name !== "route.ts") return [];
    const url = "/api/" + path.relative(API_DIR, path.dirname(full)).split(path.sep).join("/");
    const methods = [...readFileSync(full, "utf8").matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)];
    return methods.map((m) => `${m[1]} ${url}`);
  });
}

const SOME_ID = "00000000-0000-4000-8000-000000000001";
const ROLES = ["anon", "pending", "doctor", "closed", "admin"] as const;
type Caller = (typeof ROLES)[number];

async function as(caller: Caller): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: BASE_URL,
    storageState: caller === "anon" ? undefined : stateFile(caller as Role),
    maxRedirects: 0,
  });
}

async function call(ctx: APIRequestContext, key: string, headers: Record<string, string> = {}) {
  const [method, route] = key.split(" ");
  const url = route.replace("[id]", SOME_ID) + (route === "/api/search" ? "?q=x" : "");
  return ctx.fetch(url, { method, data: method === "GET" ? undefined : {}, headers });
}

test("every shipped API route has a policy, and every policy a route", () => {
  expect(shippedRoutes().sort()).toEqual(Object.keys(POLICY).sort());
});

for (const [key, policy] of Object.entries(POLICY)) {
  test(`${key} [${policy}]`, async () => {
    for (const caller of ROLES) {
      const allowed =
        policy === "public" ||
        (policy === "doctor" && caller !== "anon" && caller !== "closed") ||
        (policy === "admin" && caller === "admin");
      if (allowed && DESTRUCTIVE.has(key)) continue;
      const ctx = await as(caller);
      const res = await call(ctx, key);
      const status = res.status();
      if (allowed) {
        // Past the gate: whatever the empty body earns, never a refusal.
        expect([401, 403], `${caller} ${key} got ${status}`).not.toContain(status);
        expect(status, `${caller} ${key}`).toBeLessThan(500);
      } else {
        expect(status, `${caller} ${key}`).toBe(401);
      }
      await ctx.dispose();
    }
  });
}

test.describe("abuse limits", () => {
  test.beforeEach(flushRateLimits);
  test.afterEach(flushRateLimits);

  test("password guessing is slowed down after five tries", async () => {
    const ctx = await as("anon");
    const statuses: number[] = [];
    // Its own address and client IP: the limiter also remembers blocked
    // callers in the server's memory, which flushing Redis does not clear, so
    // sharing either with other tests would lock them out for 15 minutes.
    // (Vercel overwrites X-Forwarded-For, so production clients cannot pick one.)
    // Fresh per run too, so a retry or --repeat-each starts unblocked.
    const n = Date.now() % 250;
    const headers = { "x-forwarded-for": `203.0.113.${n}` };
    const email = `probe-${Date.now()}@e2e.test`;
    for (let i = 0; i < 6; i++) {
      const res = await ctx.post("/api/login/password", { headers, data: { email, password: `wrong-${i}-password` } });
      statuses.push(res.status());
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    await ctx.dispose();
  });
});

test.describe("machine callers", () => {
  test("cron routes refuse a wrong secret and accept the right one", async () => {
    const ctx = await as("anon");
    for (const key of Object.keys(POLICY).filter((k) => POLICY[k] === "cron")) {
      expect((await call(ctx, key, { Authorization: "Bearer wrong" })).status(), key).toBe(401);
    }
    // The institutions job only reads and relinks; it is safe to run here.
    const ok = await call(ctx, "GET /api/cron/institutions", { Authorization: `Bearer ${CRON_SECRET}` });
    expect(ok.status()).toBe(200);
    await ctx.dispose();
  });

  test("the SMS hook refuses an unsigned or wrongly signed call", async () => {
    const ctx = await as("anon");
    const res = await call(ctx, "POST /api/auth/hooks/send-otp", {
      "webhook-id": "msg_1",
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      "webhook-signature": "v1,AAAA",
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  // The path every real login SMS takes: Supabase Auth signs a call to our
  // hook, the hook checks the signature and that the number belongs to a
  // doctor or a signup in progress, then sends through SMS4FREE (the stub
  // here), and the code that arrives signs the doctor in. Calling Supabase
  // directly with the public key, as here, skips our own routes, which is
  // exactly what the hook's recipient check is for. CI only: on Docker
  // Desktop the Auth container cannot reach an app running in WSL.
  test("Supabase can only text registered numbers, through the signed hook", async () => {
    test.skip(!process.env.CI, "needs Docker networking to reach the app");
    const headers = { apikey: ANON_KEY, "Content-Type": "application/json" };
    const askForCode = (phone: string) =>
      fetch(`${SUPABASE_URL}/auth/v1/otp`, { method: "POST", headers, body: JSON.stringify({ phone }) });
    const inbox = async (local: string) =>
      (await (await fetch(`${STUB_URL}/sms4free/messages?to=${local}`)).json()) as { msg: string; sender: string }[];

    // A number nobody registered: refused, nothing sent.
    const stranger = await askForCode("+972521110066");
    expect(stranger.status).not.toBe(200);
    expect(await inbox("0521110066")).toEqual([]);

    // A doctor's number: delivered, and the code works.
    const doctor = await createDoctor({ first: "صاحب", family: "الرقم", phone: "+972521110077" });
    try {
      const res = await askForCode("+972521110077");
      expect(res.status, await res.text()).toBe(200);
      const sent = await inbox("0521110077");
      expect(sent.length).toBeGreaterThan(0);
      const { msg, sender } = sent[sent.length - 1];
      expect(sender).toBe("JDoctors");
      const code = msg.match(/\d{6}/)?.[0];
      expect(code, msg).toBeTruthy();
      const verify = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone: "+972521110077", token: code, type: "sms" }),
      });
      expect(verify.status).toBe(200);
    } finally {
      await doctor.remove();
    }
  });
});
