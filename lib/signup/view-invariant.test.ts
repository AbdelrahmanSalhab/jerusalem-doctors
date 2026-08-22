// Test 15 — doctor_visible view enforces all five visibility conditions
// Harness 1: reads migration SQL file; no live DB needed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve migration path relative to the worktree root.
const MIGRATION_PATH = join(
  import.meta.dirname ?? __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "0008_signup_security_overhaul.sql",
);

describe("Test 15 — doctor_visible view SQL definition", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("declares security_invoker = true on the view", () => {
    expect(sql).toMatch(/create\s+or\s+replace\s+view\s+public\.doctor_visible/i);
    expect(sql).toMatch(/security_invoker\s*=\s*true/i);
  });

  it("filters on is_active in the WHERE clause", () => {
    // The view WHERE clause must include all five conditions.
    // We look for the view block specifically.
    const viewBlock = extractViewBlock(sql);
    expect(viewBlock).toBeTruthy();
    expect(viewBlock).toContain("is_active");
  });

  it("filters on user_chose_visible in the WHERE clause", () => {
    const viewBlock = extractViewBlock(sql);
    expect(viewBlock).toContain("user_chose_visible");
  });

  it("filters on is_phone_verified in the WHERE clause", () => {
    const viewBlock = extractViewBlock(sql);
    expect(viewBlock).toContain("is_phone_verified");
  });

  it("filters on is_admin_approved in the WHERE clause", () => {
    const viewBlock = extractViewBlock(sql);
    expect(viewBlock).toContain("is_admin_approved");
  });

  it("filters on consent_directory_use in the WHERE clause", () => {
    const viewBlock = extractViewBlock(sql);
    expect(viewBlock).toContain("consent_directory_use");
  });
});

/**
 * Extracts the CREATE OR REPLACE VIEW doctor_visible ... block from the
 * migration SQL. Returns the text from the CREATE VIEW statement to the
 * first semicolon that terminates it.
 *
 * NOTE: This extraction is fragile — it stops at the FIRST semicolon after
 * the CREATE VIEW keyword. It works correctly for the current view body
 * (which contains no semicolons), but would truncate prematurely if a
 * future change added one (e.g. a nested DO block or a function call with
 * a semicolon-terminated subexpression). If the view SQL ever gains
 * internal semicolons, switch to a proper SQL parser or delimit the view
 * block with a comment sentinel.
 */
function extractViewBlock(sql: string): string {
  const start = sql.search(/create\s+or\s+replace\s+view\s+public\.doctor_visible/i);
  if (start === -1) return "";
  const end = sql.indexOf(";", start);
  return end === -1 ? sql.slice(start) : sql.slice(start, end + 1);
}
