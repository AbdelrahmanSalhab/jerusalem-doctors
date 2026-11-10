// Who may change another admin's account. An admin runs the directory, but
// changing a peer's phone number moves their sign-in (they could then receive
// the peer's SMS code), and suspending or erasing a peer removes them and, for
// an erase, their audit trail. So acting on another admin takes a super admin
// (lib/auth/superAdmin.ts); acting on yourself, or on a doctor, takes nothing
// more. No SUPER_ADMIN_EMAILS means no one, which is the safe default.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/respond";
import { isSuperAdmin } from "@/lib/auth/superAdmin";

/** Null when the actor may go on; otherwise the 403 to return. */
export async function refuseAdminTarget(
  service: SupabaseClient,
  actor: { id: string; auth_user_id: string | null },
  target: { id: string; is_admin: boolean | null },
): Promise<NextResponse | null> {
  if (!target.is_admin || target.id === actor.id) return null;
  if (await isSuperAdmin(service, actor.auth_user_id)) return null;
  return jsonError(403, { error: "admin_protected", code: "admin_protected" });
}
