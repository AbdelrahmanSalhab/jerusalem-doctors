// The production smoke check's sign-in (POST /api/login/ci): a GitHub Actions
// token for this repository's smoke workflow signs in the CI account, once.
// e2e/stubs.mjs plays GitHub: it signs the tokens and serves the keys.

import { request as http } from "@playwright/test";
import { BASE_URL, CI_LOGIN_EMAIL, STUB_URL } from "../env";
import { expect, test } from "../fixtures";
import { flushRateLimits } from "../global-setup";
import { createDoctor, serviceClient } from "../seed";

/** A token from the stub, with some claims changed. */
async function githubToken(claims: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${STUB_URL}/github-oidc/token`, { method: "POST", body: JSON.stringify(claims) });
  return (await res.json()).value;
}

test("a GitHub token from the smoke workflow signs in the CI account, once", async () => {
  await flushRateLimits();
  const ci = await createDoctor({ first: "اختبار", family: "آلي", loginEmail: CI_LOGIN_EMAIL, admin: true, visible: false });
  const ctx = await http.newContext({ baseURL: BASE_URL });
  try {
    const token = await githubToken({ run_id: "4242" });
    expect((await ctx.post("/api/login/ci", { data: { token } })).status()).toBe(200);
    expect((await ctx.get("/api/admin/migrations")).status(), "signed in as an admin").toBe(200);

    // The same token again: refused.
    const again = await http.newContext({ baseURL: BASE_URL });
    expect((await again.post("/api/login/ci", { data: { token } })).status()).toBe(401);
    await again.dispose();

    const { data } = await serviceClient()
      .from("audit_logs")
      .select("metadata")
      .eq("action", "ci_login")
      .eq("actor_doctor_id", ci.id);
    expect(data?.map((r) => r.metadata)).toEqual([
      { ci_run: "https://github.com/AbdelrahmanSalhab/jerusalem-doctors/actions/runs/4242", event: "deployment_status" },
    ]);
  } finally {
    await ctx.dispose();
    await ci.remove();
    await flushRateLimits();
  }
});

test("anything but the smoke workflow's fresh token is refused", async () => {
  await flushRateLimits();
  const ctx = await http.newContext({ baseURL: BASE_URL });
  for (const claims of [
    { workflow_ref: "AbdelrahmanSalhab/jerusalem-doctors/.github/workflows/ci.yml@refs/heads/main" },
    { repository: "someone/jerusalem-doctors" },
    { event_name: "pull_request" },
    { exp: Math.floor(Date.now() / 1000) - 1 },
  ]) {
    const res = await ctx.post("/api/login/ci", { data: { token: await githubToken(claims) } });
    expect(res.status(), JSON.stringify(claims)).toBe(401);
  }
  expect((await ctx.post("/api/login/ci", { data: { token: "x".repeat(40) } })).status()).toBe(401);
  await ctx.dispose();
  await flushRateLimits();
});
