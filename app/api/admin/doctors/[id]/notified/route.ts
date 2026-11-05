// POST /api/admin/doctors/[id]/notified, an admin opened the WhatsApp message
// that tells a just-accepted doctor they are in. Doctors get no push, so this
// is the only record that someone told them; without it a doctor whose admin
// closed the panel waits for a message that was never sent.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { writeAudit } from "@/lib/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const POST = withJsonErrors(async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  const service = createSupabaseServiceClient();
  const found = await service.from("doctors").select("id, is_admin_approved").eq("id", id).maybeSingle();
  if (found.error && found.error.code !== "PGRST116") throw found.error;
  if (!found.data) return jsonError(404, { error: "not_found", code: "not_found" });

  // Only an accepted doctor has been told anything.
  if (!found.data.is_admin_approved) return jsonError(409, { error: "not_accepted", code: "not_accepted" });

  await writeAudit(service, { actor_doctor_id: admin.id, action: "approval_notified", target_doctor_id: id });
  return jsonOk({ ok: true });
});
