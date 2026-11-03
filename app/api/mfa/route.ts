// GET /api/mfa: where an admin's authenticator stands, for «ملفي» (has one
// been set up?) and for the code step at sign-in (is this session waiting
// for the code?). Asked of a password session that has not passed the code
// yet, so it is the signed-in doctor who is checked, not getCurrentAdmin.

import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const GET = withJsonErrors(async () => {
  const me = await requireDoctor().catch(() => null);
  if (!me?.is_admin || !me.auth_user_id) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const mfa = (await createSupabaseServerClient()).auth.mfa;
  const [factors, level] = await Promise.all([mfa.listFactors(), mfa.getAuthenticatorAssuranceLevel()]);
  // The auth server no longer knows this session (its password was changed
  // from elsewhere, say): the page's token still checks out, the session
  // does not.
  if ([factors.error, level.error].some((e) => e?.name === "AuthSessionMissingError")) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  if (factors.error || level.error) return jsonError(502, { error: "mfa_unavailable", code: "mfa_unavailable" });
  return jsonOk({
    enrolled: factors.data.totp.length > 0,
    waiting: level.data.currentLevel === "aal1" && level.data.nextLevel === "aal2",
  });
});
