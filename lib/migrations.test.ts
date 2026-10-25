// Two people add migrations; two files with the same number make Supabase
// refuse to build the schema ("duplicate key ... schema_migrations"), and
// the e2e job only says so after several minutes. This says it in seconds.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.join(__dirname, "../supabase/migrations");

describe("supabase/migrations", () => {
  it("numbers every migration once", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
    const byNumber = new Map<string, string[]>();
    for (const f of files) {
      const n = f.match(/^(\d+)_/)?.[1];
      expect(n, `${f} has no number prefix`).toBeTruthy();
      byNumber.set(n!, [...(byNumber.get(n!) ?? []), f]);
    }
    const clashes = [...byNumber.values()].filter((fs) => fs.length > 1);
    expect(clashes, "rename the newer one with `npx supabase migration new` (supabase/migrations/README.md)").toEqual([]);
  });

  // applied_migrations: production's record of what it ran, which the smoke
  // check compares with these files.
  const LEDGER = "20261025103141_migration_ledger";
  const names = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();
  const sql = (name: string) => readFileSync(path.join(DIR, `${name}.sql`), "utf8");

  it("records every migration from the ledger on, each under its own name", () => {
    const forgot = names
      .filter((n) => n >= LEDGER)
      .filter((n) => !sql(n).includes(`insert into public.applied_migrations (name) values ('${n}') on conflict do nothing;`));
    expect(forgot, "end each with its own insert (supabase/migrations/README.md, step 4)").toEqual([]);
  });

  it("records the files before the ledger in the ledger itself", () => {
    const listed = [...sql(LEDGER).matchAll(/^  \('([^']+)'\),?$/gm)].map((m) => m[1]);
    expect(listed).toEqual(names.filter((n) => n < LEDGER));
  });
});
