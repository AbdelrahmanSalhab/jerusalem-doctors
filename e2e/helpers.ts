import { readFileSync } from "node:fs";
import path from "node:path";
import type { Role } from "./env";

export const AUTH_DIR = path.join(__dirname, ".auth");
export const IDS_FILE = path.join(AUTH_DIR, "ids.json");

/** The app server's output during the run (playwright.config.ts). */
export const SERVER_LOG = path.join(__dirname, ".results", "server.log");

/** Saved session for a role, from global-setup. */
export const stateFile = (role: Role) => path.join(AUTH_DIR, `${role}.json`);

/** Seeded doctor ids by key (e2e/seed.ts). */
export function seededIds(): Record<string, string> {
  return JSON.parse(readFileSync(IDS_FILE, "utf8"));
}
