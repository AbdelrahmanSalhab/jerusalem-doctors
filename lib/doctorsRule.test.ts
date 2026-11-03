// The ESLint rule that keeps directory code off the doctors table (#158),
// run against the real config: a new route that lists doctors must read the
// listed_doctors view, and the files that need the row itself are the
// allowlist in eslint.config.mjs.

import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });
const SOURCE = 'export const rows = (service: { from: (t: string) => unknown }) => service.from("doctors");\n';

async function messages(file: string, code = SOURCE) {
  const [result] = await eslint.lintText(code, { filePath: path.join(process.cwd(), file) });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("no direct reads of the doctors table", () => {
  it("stops a new route that lists doctors, and points to the view", async () => {
    const found = await messages("app/api/colleagues/route.ts");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("listed_doctors");
    expect(found[0].message).toContain("eslint.config.mjs");
  });

  it("stops a page and a library the same way", async () => {
    expect(await messages("app/dashboard/page.tsx")).toHaveLength(1);
    expect(await messages("lib/newDirectoryRead.ts")).toHaveLength(1);
  });

  it("lets the code that needs the row itself read it: the admin panel, sign-in and sign-up, the cron jobs, the session", async () => {
    for (const file of ["app/api/admin/doctors/[id]/route.ts", "app/(admin)/admin/page.tsx", "app/api/login/start/route.ts", "app/api/signup/start/route.ts", "app/api/cron/sync-moh/route.ts", "lib/auth/session.ts", "lib/otp/owner.ts"]) {
      expect(await messages(file), file).toHaveLength(0);
    }
  });

  it("does not mind the view, or any other table, or a test file", async () => {
    expect(await messages("app/api/colleagues/route.ts", SOURCE.replace("doctors", "listed_doctors"))).toHaveLength(0);
    expect(await messages("app/api/colleagues/route.ts", SOURCE.replace("doctors", "specialties"))).toHaveLength(0);
    expect(await messages("app/api/colleagues/route.test.ts")).toHaveLength(0);
  });
});
