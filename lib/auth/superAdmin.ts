// The super admins of the second factor (#164): the two people who may reset
// another admin's authenticator when a phone is lost. A short list in
// SUPER_ADMIN_EMAILS (Vercel), checked against the sign-in address of the
// admin asking, so being an admin is not enough.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Addresses on the list, lowercased. */
export function superAdminEmails(raw: string | undefined = process.env.SUPER_ADMIN_EMAILS): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

/** Whether this auth user signs in with an address on the list. */
export async function isSuperAdmin(service: SupabaseClient, authUserId: string | null): Promise<boolean> {
  if (!authUserId) return false;
  const list = superAdminEmails();
  if (list.length === 0) return false;
  const user = (await service.auth.admin.getUserById(authUserId)).data.user;
  // An address nobody has confirmed proves nothing about who holds it.
  const email = user?.email_confirmed_at ? user.email?.toLowerCase() : undefined;
  return email !== undefined && list.includes(email);
}
