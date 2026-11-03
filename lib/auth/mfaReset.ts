// Resetting an admin's second factor (#164): the authenticator is removed and
// a one-hour window opens in which that admin may enrol a new one, because
// with the flag on a password session without its code cannot enrol
// (app/api/mfa/enroll). The window is the account's own app_metadata, so it
// needs no table and ends by itself.

import type { SupabaseClient } from "@supabase/supabase-js";

export const ENROL_WINDOW_MS = 60 * 60 * 1000;

/** Removes every factor of the user and opens the enrolment window. Returns
 *  how many factors were removed. */
export async function resetSecondFactor(service: SupabaseClient, userId: string, now = Date.now()): Promise<number> {
  const listed = await service.auth.admin.mfa.listFactors({ userId });
  if (listed.error) throw listed.error;
  const factors = listed.data.factors;
  for (const f of factors) {
    const { error } = await service.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    if (error) throw error;
  }
  const opened = await service.auth.admin.updateUserById(userId, { app_metadata: { mfa_enrol_until: now + ENROL_WINDOW_MS } });
  if (opened.error) throw opened.error;
  return factors.length;
}

/** Whether the user's enrolment window is open. */
export async function enrolWindowOpen(service: SupabaseClient, userId: string, now = Date.now()): Promise<boolean> {
  const until = (await service.auth.admin.getUserById(userId)).data.user?.app_metadata?.mfa_enrol_until;
  return typeof until === "number" && until > now;
}

/** Closes it once the new factor is confirmed. */
export async function closeEnrolWindow(service: SupabaseClient, userId: string): Promise<void> {
  await service.auth.admin.updateUserById(userId, { app_metadata: { mfa_enrol_until: null } });
}
