// Signs the CI account out at the end of the run, so its session does not
// outlive the run that needed it, and removes the saved copy.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { request, test } from "@playwright/test";

const STATE = join(__dirname, "..", ".results", "smoke-session.json");

test("sign the CI account out", async ({ baseURL }) => {
  test.skip(!existsSync(STATE), "nobody signed in");
  const ctx = await request.newContext({ baseURL, storageState: STATE });
  await ctx.post("/api/auth/logout");
  await ctx.dispose();
  rmSync(STATE);
});
