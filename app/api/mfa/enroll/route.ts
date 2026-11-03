// POST /api/mfa/enroll: starts an authenticator for the signed-in admin and
// returns what the app needs to scan: a QR code and the same secret as text.
// The factor does not count until its first code is confirmed
// (/api/mfa/verify), so a scan that went wrong locks nobody out.

import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const POST = withJsonErrors(async () => {
  const me = await requireDoctor().catch(() => null);
  if (!me?.is_admin || !me.auth_user_id) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const rl = await rateLimit("mfaEnroll", `doctor:${me.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const mfa = (await createSupabaseServerClient()).auth.mfa;
  const { data: listed, error: listError } = await mfa.listFactors();
  if (listError) return jsonError(502, { error: "mfa_unavailable", code: "mfa_unavailable" });
  // Already set up: replacing a working factor is the super admins' job
  // (a lost phone), not something a session can do for itself.
  if (listed.totp.length > 0) return jsonError(409, { error: "already_enrolled", code: "already_enrolled" });

  // A scan that was never confirmed is left unverified and would block a new
  // one under the same name.
  await Promise.all(listed.all.filter((f) => f.status === "unverified").map((f) => mfa.unenroll({ factorId: f.id })));
  const { data, error } = await mfa.enroll({ factorType: "totp", friendlyName: `admin-${Date.now()}` });
  if (error || !data) return jsonError(502, { error: "mfa_unavailable", code: "mfa_unavailable" });
  return jsonOk({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
});
