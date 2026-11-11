// GitHub Actions' OpenID Connect tokens, for the production smoke check's
// sign-in (POST /api/login/ci). A workflow with `id-token: write` can ask
// GitHub for a short-lived token, signed by GitHub, naming the repository,
// the workflow file and the event that ran it. Checking that signature and
// those claims replaces a stored password: there is nothing to leak.
//
// Who can obtain a token that passes: the smoke workflow file as it stands on
// main, on GitHub's own runners. A branch's copy never passes: anyone with
// write access can push a branch, and a preview deploy of it fires
// deployment_status, which runs that branch's workflow file. Changing main
// goes through review. Pull requests from forks get no id-token permission.
// Vercel records each deployment's ref as a commit SHA, so a deployment_status
// run names the workflow as smoke.yml@<sha>: that SHA must be on main.
// https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect

import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
/** What the workflow asks for, and the only audience accepted. */
export const CI_AUDIENCE = "jerusalem-doctors-smoke";
export const REPOSITORY = "Salhab-Brothers/jerusalem-doctors";
const SMOKE_WORKFLOW = `${REPOSITORY}/.github/workflows/smoke.yml@`;
/** The smoke workflow's own triggers (.github/workflows/smoke.yml). */
const EVENTS = new Set(["deployment_status", "schedule", "workflow_dispatch"]);
/** GitHub issues them for a few minutes; older than this is a replay. */
const MAX_AGE_SECONDS = 10 * 60;

export interface CiClaims {
  /** Unique per token: lets the route accept each one once. */
  jti: string;
  repository: string;
  workflow_ref: string;
  event_name: string;
  run_id: string;
  runner_environment: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}
export type KeyLookup = (kid: string) => Promise<Jwk | undefined>;

let cached: { at: number; keys: Jwk[] } | null = null;

/** GitHub's signing keys, fetched at most hourly. */
export const githubKey: KeyLookup = async (kid) => {
  if (!cached || Date.now() - cached.at > 3_600_000 || !cached.keys.some((k) => k.kid === kid)) {
    // GITHUB_OIDC_JWKS_URL is the e2e stub (e2e/env.ts); production never sets it.
    const jwks = process.env.GITHUB_OIDC_JWKS_URL ?? `${GITHUB_ISSUER}/.well-known/jwks`;
    const res = await fetch(jwks, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`GitHub JWKS: ${res.status}`);
    cached = { at: Date.now(), keys: ((await res.json()) as { keys: Jwk[] }).keys };
  }
  return cached.keys.find((k) => k.kid === kid);
};

/** Whether a commit is main's or one of its ancestors (a merged commit). */
export type OnMain = (sha: string) => Promise<boolean>;
const onMainShas = new Set<string>();

export const githubOnMain: OnMain = async (sha) => {
  if (onMainShas.has(sha)) return true;
  // GITHUB_API_URL is the e2e stub; production never sets it. The repository
  // is public, so no token; a failure or rate limit refuses, never allows.
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const res = await fetch(`${api}/repos/${REPOSITORY}/compare/${sha}...main`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return false;
  const { status } = (await res.json()) as { status?: string };
  const merged = status === "ahead" || status === "identical";
  if (merged) onMainShas.add(sha);
  return merged;
};

const json = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

/** The token's claims if GitHub signed it for this repository's smoke
 *  workflow and it is fresh, else null. Never throws on a bad token. */
export async function verifySmokeToken(
  token: string,
  keyOf: KeyLookup = githubKey,
  now: number = Date.now() / 1000,
  onMain: OnMain = githubOnMain,
): Promise<CiClaims | null> {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const header = json(h);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    const jwk = await keyOf(header.kid);
    if (!jwk) return null;
    const signed = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"));
    if (!signed) return null;

    const c = json(p);
    const fresh = typeof c.iat === "number" && c.iat <= now + 60 && now - c.iat <= MAX_AGE_SECONDS;
    const ok =
      c.iss === GITHUB_ISSUER &&
      c.aud === CI_AUDIENCE &&
      typeof c.exp === "number" && c.exp > now &&
      fresh &&
      c.repository === REPOSITORY &&
      typeof c.workflow_ref === "string" && c.workflow_ref.startsWith(SMOKE_WORKFLOW) &&
      EVENTS.has(c.event_name) &&
      c.runner_environment === "github-hosted" &&
      typeof c.jti === "string" && c.jti.length > 0;
    if (!ok) return null;
    const ref = (c.workflow_ref as string).slice(SMOKE_WORKFLOW.length);
    const onMainRef =
      ref === "refs/heads/main" ||
      (c.event_name === "deployment_status" && /^[0-9a-f]{40}$/.test(ref) && (await onMain(ref)));
    return onMainRef ? (c as CiClaims) : null;
  } catch {
    return null;
  }
}
