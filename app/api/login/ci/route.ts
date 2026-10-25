// POST /api/login/ci: the production smoke check signs in as the CI account
// with a token GitHub issued to the smoke workflow (lib/auth/githubOidc.ts),
// instead of a stored password.
//
// The CI account has no password and no phone, and its email is on the
// .invalid domain, so no other sign-in reaches it; the session is made here
// from a link the server asks Supabase for and uses at once, never sent.
// Off unless CI_LOGIN_EMAIL names that account (scripts/add-ci-account.ts).

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit";
import { verifySmokeToken } from "@/lib/auth/githubOidc";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({ token: z.string().min(20).max(8000) });

/** One answer for every refusal, as at /api/login/password. */
const refuse = () => jsonError(401, { error: "invalid_credentials", code: "invalid_credentials" });

export const POST = withJsonErrors(async (req: Request) => {
  const email = process.env.CI_LOGIN_EMAIL?.trim().toLowerCase();
  if (!email) return jsonError(404, { error: "not_found", code: "not_found" });

  // Before any checking: an unknown key id makes the server fetch GitHub's
  // keys again, which nobody should be able to make it do in a loop.
  const rlIp = await rateLimit("ciLoginIp", `ip:${ipFromHeaders(req)}`);
  if (!rlIp.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refuse();

  const claims = await verifySmokeToken(parsed.data.token);
  if (!claims) return refuse();
  // Each token once. ponytail: a Redis slowdown lets the limiter through
  // (lib/ratelimit.ts), so a token could then be used twice within its few
  // minutes, still only by our smoke workflow's run.
  const once = await rateLimit("ciLoginToken", `jti:${claims.jti}`);
  if (!once.success) return refuse();

  const service = createSupabaseServiceClient();
  const link = await service.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data.properties?.hashed_token;
  if (link.error || !tokenHash) throw link.error ?? new Error("ci login: no link");

  const ssr = await createSupabaseServerClient();
  const signedIn = await ssr.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (signedIn.error || !signedIn.data.user) throw signedIn.error ?? new Error("ci login: no user");

  // As at /api/login/password: a session is access only when an active
  // doctors row claims it.
  const doctor = await service
    .from("doctors")
    .select("id, is_active")
    .eq("auth_user_id", signedIn.data.user.id)
    .maybeSingle();
  if (!doctor.data?.is_active) {
    await ssr.auth.signOut();
    return refuse();
  }

  const run = `https://github.com/${claims.repository}/actions/runs/${claims.run_id}`;
  await writeAudit(service, {
    actor_doctor_id: doctor.data.id,
    action: "ci_login",
    target_doctor_id: doctor.data.id,
    metadata: { ci_run: run, event: claims.event_name },
  });
  return jsonOk({ ok: true });
});
