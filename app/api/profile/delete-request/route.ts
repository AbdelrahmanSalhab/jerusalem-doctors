// POST /api/profile/delete-request
// Soft-disables the doctor immediately and queues a delete request for the
// admin. The doctor row remains for audit purposes; admin actions the
// final state via /admin (also soft-only — no hard delete in MVP).

import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";

export const POST = withJsonErrors(async (req: Request) => {
  const me = await requireDoctor().catch(() => null);
  if (!me) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const ip = ipFromHeaders(req);
  const service = createSupabaseServiceClient();

  // Immediate effect: hide from search + mark inactive. An admin completes
  // the deletion from /admin (DELETE /api/admin/doctors/[id]).
  const r = await service
    .from("doctors")
    .update({ is_visible: false, is_active: false })
    .eq("id", me.id);
  if (r.error) {
    console.error("[profile.delete-request] update failed", r.error);
    return jsonError(500, { error: "delete_failed", code: "delete_failed" });
  }

  await writeAudit(service, {
    actor_doctor_id: me.id,
    action: "delete_requested",
    target_doctor_id: me.id,
    metadata: { ip },
  });

  // The account is suspended now; end the session with it.
  const ssr = await createSupabaseServerClient();
  await ssr.auth.signOut();

  return jsonOk({ ok: true });
});
