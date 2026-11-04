// Who may read the directory (#16). A doctor an admin has not yet accepted can
// sign in, fill in their profile and ask for help, but cannot search, see
// anyone's card or contact anyone: the registry match at signup is public data,
// so a pending account could be anyone. Staff rows may be unapproved (they are
// not in the directory), so an admin always passes.

import { jsonError } from "@/lib/api/respond";

export const canSeeDirectory = (d: { is_active: boolean; is_admin_approved: boolean; is_admin: boolean }) =>
  d.is_active && (d.is_admin_approved || d.is_admin);

/** The 403 for a route that reads or acts on the directory, or null to go on. */
export const refuseUnlessApproved = (d: { is_active: boolean; is_admin_approved: boolean; is_admin: boolean }) =>
  canSeeDirectory(d) ? null : jsonError(403, { error: "not_approved", code: "not_approved" });
