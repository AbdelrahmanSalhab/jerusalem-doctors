// Resetting an admin's second factor (#164): the authenticator is removed and
// a 15 minute window opens in which that admin may enrol a new one, because
// with the flag on a password session without its code cannot enrol
// (app/api/mfa/enroll). The window is the account's own app_metadata, so it
// needs no table and ends by itself.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Short on purpose: the reset is made in person or on a call, and while it
 *  is open a password alone can claim the factor. */
export const ENROL_WINDOW_MS = 15 * 60 * 1000;

/** Removes every factor of the user and opens the enrolment window. Returns
 *  how many factors were removed. */
export async function resetSecondFactor(service: SupabaseClient, userId: string, now = Date.now()): Promise<number> {
  // The window first: a reset that fails halfway must leave the admin able
  // to enrol again, not locked out with nothing recorded.
  const opened = await service.auth.admin.updateUserById(userId, { app_metadata: { mfa_enrol_until: now + ENROL_WINDOW_MS } });
  if (opened.error) throw opened.error;
  const listed = await service.auth.admin.mfa.listFactors({ userId });
  if (listed.error) throw listed.error;
  const factors = listed.data.factors;
  for (const f of factors) {
    const { error } = await service.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    if (error) throw error;
  }
  return factors.length;
}

/** Whether the user's enrolment window is open. */
export async function enrolWindowOpen(service: SupabaseClient, userId: string, now = Date.now()): Promise<boolean> {
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error) console.error("[mfa] enrolment window not read", error.message);
  const until = data?.user?.app_metadata?.mfa_enrol_until;
  return typeof until === "number" && until > now;
}

/** Closes it once the new factor is confirmed. */
export async function closeEnrolWindow(service: SupabaseClient, userId: string): Promise<void> {
  const { error } = await service.auth.admin.updateUserById(userId, { app_metadata: { mfa_enrol_until: null } });
  if (error) console.error("[mfa] enrolment window not closed", error.message);
}
