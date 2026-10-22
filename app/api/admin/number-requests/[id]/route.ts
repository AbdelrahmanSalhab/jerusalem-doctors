// PATCH /api/admin/number-requests/[id], close a request once the number
// has been sent to the doctor who asked.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { writeAudit } from "@/lib/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const PATCH = withJsonErrors(async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) => {
  const admin = await requireAdminOrNull();
  if (!admin) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  const service = createSupabaseServiceClient();
  // Only an open request closes: a second admin's click finds nothing.
  const r = await service
    .from("number_requests")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id)
    .is("resolved_at", null)
    .select("requester_id, query")
    .maybeSingle();
  if (r.error) {
    console.error("[admin.number-requests.patch] failed", r.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }
  if (!r.data) return jsonError(404, { error: "not_found", code: "not_found" });

  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "number_request_resolved",
    target_doctor_id: r.data.requester_id,
    metadata: { query: r.data.query },
  });

  return jsonOk({ ok: true });
});
