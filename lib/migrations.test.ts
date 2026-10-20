// Two people add migrations; two files with the same number make Supabase
// refuse to build the schema ("duplicate key ... schema_migrations"), and
// the e2e job only says so after several minutes. This says it in seconds.

import { readdirSync } from "node:fs";
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
    expect(clashes, "renumber the newer one to the next free number").toEqual([]);
  });
});
