// The smoke check's sign-in token (lib/auth/githubOidc.ts): only GitHub's
// signature, for this repository's smoke workflow, fresh, is accepted.

import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CI_AUDIENCE, GITHUB_ISSUER, REPOSITORY, verifySmokeToken } from "./githubOidc";

const NOW = 1_800_000_000;
const github = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...github.publicKey.export({ format: "jwk" }), kid: "k1" };
const keyOf = async (kid: string) => (kid === "k1" ? jwk : undefined);

const CLAIMS = {
  iss: GITHUB_ISSUER,
  aud: CI_AUDIENCE,
  iat: NOW - 30,
  exp: NOW + 270,
  jti: "a7c1",
  repository: REPOSITORY,
  workflow_ref: `${REPOSITORY}/.github/workflows/smoke.yml@refs/heads/main`,
  event_name: "deployment_status",
  run_id: "123",
  runner_environment: "github-hosted",
};

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(claims: object, key = github.privateKey, header: object = { alg: "RS256", kid: "k1" }) {
  const body = `${b64(header)}.${b64(claims)}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), key).toString("base64url")}`;
}
const check = (t: string) => verifySmokeToken(t, keyOf, NOW);

describe("verifySmokeToken", () => {
  it("accepts GitHub's token for this repository's smoke workflow", async () => {
    expect(await check(token(CLAIMS))).toMatchObject({ jti: "a7c1", run_id: "123" });
  });

  it("refuses a token signed by anyone else, or with an unknown key", async () => {
    expect(await check(token(CLAIMS, other.privateKey))).toBeNull();
    expect(await check(token(CLAIMS, github.privateKey, { alg: "RS256", kid: "nope" }))).toBeNull();
    expect(await check(token(CLAIMS, github.privateKey, { alg: "none", kid: "k1" }))).toBeNull();
  });

  it("refuses a tampered token", async () => {
    const [h, , s] = token(CLAIMS).split(".");
    expect(await check(`${h}.${b64({ ...CLAIMS, repository: "someone/else" })}.${s}`)).toBeNull();
  });

  it.each([
    ["another repository", { repository: "someone/jerusalem-doctors" }],
    ["another workflow", { workflow_ref: `${REPOSITORY}/.github/workflows/ci.yml@refs/heads/main` }],
    ["a pull request", { event_name: "pull_request" }],
    ["a self-hosted runner", { runner_environment: "self-hosted" }],
    ["another audience", { aud: "https://github.com/AbdelrahmanSalhab" }],
    ["another issuer", { iss: "https://example.com" }],
    ["an expired token", { exp: NOW - 1 }],
    ["an old token", { iat: NOW - 11 * 60 }],
    ["no jti", { jti: "" }],
  ])("refuses %s", async (_, change) => {
    expect(await check(token({ ...CLAIMS, ...change }))).toBeNull();
  });

  it("never throws on garbage", async () => {
    for (const t of ["", "a.b", "a.b.c", "....", token(CLAIMS).replace(/\./, "")]) {
      expect(await check(t)).toBeNull();
    }
  });
});
