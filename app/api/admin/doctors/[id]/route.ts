// PATCH /api/admin/doctors/[id]
// Admin-only moderation toggles for is_admin_approved + is_active.
// Audit-logs every state change.

import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  is_admin_approved: z.boolean().optional(),
  is_active: z.boolean().optional(),
  is_visible: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminOrNull();
  if (!admin) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const { id } = await ctx.params;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }
  if (Object.keys(body).length === 0) {
    return jsonError(400, { error: "no_fields", code: "no_fields" });
  }

  const service = createSupabaseServiceClient();
  const r = await service.from("doctors").update(body).eq("id", id);
  if (r.error) {
    console.error("[admin.doctors.patch] update failed", r.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }

  await service.from("audit_logs").insert({
    actor_doctor_id: admin.id,
    action: "admin_doctor_updated",
    target_doctor_id: id,
    metadata: body,
  });

  return jsonOk({ ok: true });
}

async function requireAdminOrNull() {
  try {
    return await requireAdmin();
  } catch {
    return null;
  }
}
