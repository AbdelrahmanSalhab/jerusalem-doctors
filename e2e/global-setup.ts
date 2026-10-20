// Before every run: empty the rate-limit store, reseed the database, and sign
// each role in once through /login/dev so tests reuse the sessions.

import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "@playwright/test";
import { ACCOUNTS, BASE_URL, PASSWORD, REDIS_REST_TOKEN, REDIS_REST_URL, type Role } from "./env";
import { seed, serviceClient } from "./seed";
import { AUTH_DIR, IDS_FILE, stateFile } from "./helpers";

export async function flushRateLimits() {
  const res = await fetch(REDIS_REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["FLUSHALL"]),
  });
  if (!res.ok) throw new Error(`flush rate limits: ${res.status}`);
}

export async function signIn(role: Role): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const res = await ctx.post("/api/login/password", { data: { email: ACCOUNTS[role], password: PASSWORD } });
  if (!res.ok()) throw new Error(`sign in ${role}: ${res.status()} ${await res.text()}`);
  await ctx.storageState({ path: stateFile(role) });
  await ctx.dispose();
}

export default async function globalSetup() {
  mkdirSync(AUTH_DIR, { recursive: true });
  await flushRateLimits();
  const ids = await seed();
  writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2));
  for (const role of Object.keys(ACCOUNTS) as Role[]) await signIn(role);
  // A closed account keeps a live session; the app must still refuse it.
  const { error } = await serviceClient().from("doctors").update({ is_active: false }).eq("id", ids.closed);
  if (error) throw new Error(`close account: ${error.message}`);
  await flushRateLimits();
}
