// After a verified OTP: point the doctor row at the auth user that just
// proved the phone. Older rows may exist without an auth.users link (the dev
// seed, rows created before login was wired up), and getCurrentDoctor() finds
// doctors by auth_user_id.

import type { SupabaseClient } from "@supabase/supabase-js";

/** False when the link was needed and the update failed. */
export async function linkAuthUser(
  service: SupabaseClient,
  doctor: { id: string; auth_user_id: string | null },
  userId: string,
): Promise<boolean> {
  if (doctor.auth_user_id === userId) return true;
  const { error } = await service
    .from("doctors")
    .update({ auth_user_id: userId })
    .eq("id", doctor.id);
  if (error) {
    console.error("[auth/link] auth_user_id link failed", error);
    return false;
  }
  return true;
}
