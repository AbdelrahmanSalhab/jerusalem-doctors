// PATCH /api/admin/reports/[id], close a profile report with a note on what
// the admin found or did (/admin/reports).

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { writeAudit } from "@/lib/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({ note: z.string().trim().min(2).max(500) });

export const PATCH = withJsonErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, { error: "invalid_body", code: "invalid_body" });

  const service = createSupabaseServiceClient();
  // Only an open report closes: a second admin's click finds nothing.
  const r = await service
    .from("profile_reports")
    .update({ resolved_at: new Date().toISOString(), resolved_by: admin.id, resolution_note: parsed.data.note })
    .eq("id", id)
    .is("resolved_at", null)
    .select("target_doctor_id")
    .maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) return jsonError(404, { error: "not_found", code: "not_found" });

  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "profile_report_resolved",
    target_doctor_id: r.data.target_doctor_id,
    metadata: { report_id: id, note: parsed.data.note },
  });
  return jsonOk({ ok: true });
});
