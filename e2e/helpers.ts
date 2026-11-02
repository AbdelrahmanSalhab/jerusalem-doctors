import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PORT, type Role } from "./env";

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

/** Whether Supabase Auth, from inside its container, reaches the app at the
 *  address its Send SMS hook points to (supabase/config.toml). In CI it does.
 *  Under Docker Desktop with the app in WSL, host.docker.internal is the
 *  Windows host, which has no route to it ("connection refused"), so a test
 *  that needs a real hook call (a number outside test_otp) cannot run there.
 *  See e2e/README.md. */
export async function authReachesApp(): Promise<boolean> {
  const project = /^project_id = "(.+)"$/m.exec(readFileSync(path.join(__dirname, "..", "supabase", "config.toml"), "utf8"))?.[1];
  try {
    await promisify(execFile)("docker", ["exec", `supabase_auth_${project}`, "wget", "-q", "-O", "-", "--timeout=3", `http://host.docker.internal:${PORT}/login`]);
    return true;
  } catch {
    return false;
  }
}
