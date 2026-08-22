// POST /api/profile/delete-request
// Soft-disables the doctor immediately and queues a delete request for the
// admin. The doctor row remains for audit purposes; admin actions the
// final state via /admin (also soft-only — no hard delete in MVP).

import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const POST = withJsonErrors(async (req: Request) => {
  const me = await requireDoctor().catch(() => null);
  if (!me) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const ip = ipFromHeaders(req);
  const service = createSupabaseServiceClient();

  // Immediate effect: hide from search + mark inactive. Admin will see in
  // queue and confirm. The doctor's session stays valid for now; their next
  // protected route hit will redirect via requireDoctor's is_active check.
  const r = await service
    .from("doctors")
    .update({ is_visible: false, is_active: false })
    .eq("id", me.id);
  if (r.error) {
    console.error("[profile.delete-request] update failed", r.error);
    return jsonError(500, { error: "delete_failed", code: "delete_failed" });
  }

  await service.from("audit_logs").insert({
    actor_doctor_id: me.id,
    action: "delete_requested",
    target_doctor_id: me.id,
    metadata: { ip },
  });

  return jsonOk({ ok: true });
});
