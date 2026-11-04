// Who may read the directory (#16). A doctor an admin has not yet accepted can
// sign in, fill in their profile and ask for help, but cannot search, see
// anyone's card or contact anyone: the registry match at signup is public data,
// so a pending account could be anyone. Staff rows may be unapproved (they are
// not in the directory), so an admin passes, but only once past the second
// factor: a leaked admin password alone must not open the directory.
//
// Every route and page that reads or acts on the directory calls this
// (e2e/api/authz.spec.ts lists each API route's policy, so a new route cannot
// ship without someone deciding which kind it is).

import { jsonError } from "@/lib/api/respond";
import { awaitingSecondFactor } from "@/lib/auth/session";

interface Viewer {
  is_active: boolean;
  is_admin_approved: boolean;
  is_admin: boolean;
}

export async function canSeeDirectory(d: Viewer): Promise<boolean> {
  if (!d.is_active) return false;
  if (d.is_admin && (await awaitingSecondFactor())) return false;
  return d.is_admin_approved || d.is_admin;
}

/** The 403 for a route that reads or acts on the directory, or null to go on. */
export async function refuseUnlessApproved(d: Viewer) {
  return (await canSeeDirectory(d)) ? null : jsonError(403, { error: "not_approved", code: "not_approved" });
}
