// A second factor for the admin accounts that sign in with a password (#164).
//
// A password alone used to be enough to reach /admin: one leaked through a
// public CI artifact once (#162). With Supabase's TOTP (an authenticator app
// code), a session that began with a password only counts as an admin's once
// it has passed the code challenge, which raises its assurance level (`aal`)
// from aal1 to aal2.
//
// Only password sessions are asked: a doctor who signs in by phone code is not
// affected, and the smoke check's sign-in (a link the server makes for itself
// and uses at once, /api/login/ci) has no password in its history.
//
// Off until ADMIN_MFA=1, which is set once every password account has enrolled
// (docs/runbook.md); until then nobody can be locked out.

/** What the session's verified token says about how it was made. */
export interface SessionClaims {
  sub?: string;
  /** "aal1" after one factor, "aal2" after the TOTP challenge too. */
  aal?: string;
  /** The methods used to get the session, newest last. */
  amr?: { method?: string }[];
}

/** True when this session may not use the admin panel yet: it came from a
 *  password and has not passed the second factor. */
export function needsSecondFactor(
  claims: SessionClaims | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.ADMIN_MFA !== "1") return false;
  const byPassword = Boolean(claims?.amr?.some((a) => a.method === "password"));
  return byPassword && claims?.aal !== "aal2";
}
