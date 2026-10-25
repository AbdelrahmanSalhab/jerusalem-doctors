// GitHub Actions' OpenID Connect tokens, for the production smoke check's
// sign-in (POST /api/login/ci). A workflow with `id-token: write` can ask
// GitHub for a short-lived token, signed by GitHub, naming the repository,
// the workflow file and the event that ran it. Checking that signature and
// those claims replaces a stored password: there is nothing to leak.
//
// Who can obtain a token that passes: a workflow file at SMOKE_WORKFLOW in
// this repository, on GitHub's own runners. Changing that file takes write
// access to the repository, the same trust a secret relied on. Pull requests
// from forks get no id-token permission.
// https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect

import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
/** What the workflow asks for, and the only audience accepted. */
export const CI_AUDIENCE = "jerusalem-doctors-smoke";
export const REPOSITORY = "AbdelrahmanSalhab/jerusalem-doctors";
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

const json = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

/** The token's claims if GitHub signed it for this repository's smoke
 *  workflow and it is fresh, else null. Never throws on a bad token. */
export async function verifySmokeToken(
  token: string,
  keyOf: KeyLookup = githubKey,
  now: number = Date.now() / 1000,
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
    return ok ? (c as CiClaims) : null;
  } catch {
    return null;
  }
}
