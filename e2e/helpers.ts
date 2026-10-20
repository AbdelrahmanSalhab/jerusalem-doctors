import { readFileSync } from "node:fs";
import path from "node:path";
import type { Role } from "./env";

export const AUTH_DIR = path.join(__dirname, ".auth");
export const IDS_FILE = path.join(AUTH_DIR, "ids.json");

/** Saved session for a role, from global-setup. */
export const stateFile = (role: Role) => path.join(AUTH_DIR, `${role}.json`);

/** Seeded doctor ids by key (e2e/seed.ts). */
export function seededIds(): Record<string, string> {
  return JSON.parse(readFileSync(IDS_FILE, "utf8"));
}
