// The repo's migrations by name (supabase/migrations/*.sql without the
// extension): what a database should have recorded in applied_migrations.
// Shared by lib/migrations.test.ts, the e2e run and the production smoke check.

import { readdirSync } from "node:fs";
import path from "node:path";

export const MIGRATIONS_DIR = path.join(__dirname, "../supabase/migrations");

export function repoMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();
}
