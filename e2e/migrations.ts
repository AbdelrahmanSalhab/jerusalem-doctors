// The repo's migrations by name (supabase/migrations/*.sql without the
// extension), to compare with what a database recorded (applied_migrations).

import { readdirSync } from "node:fs";
import path from "node:path";

export function repoMigrations(): string[] {
  return readdirSync(path.join(__dirname, "../supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();
}
