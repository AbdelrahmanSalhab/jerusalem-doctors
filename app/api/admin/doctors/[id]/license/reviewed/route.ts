// POST /api/admin/doctors/[id]/license/reviewed: «تمت المراجعة». An admin has
// looked at this doctor's licence and accepts it as it stands, so it leaves
// «ترخيص يحتاج مراجعة» without the registry having to confirm it: a
// Palestinian licence has no registry to, and an Israeli one the registry does
// not list may be real. The nightly sync clears the mark if it flags the
// licence again.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({ note: z.string().trim().max(300).optional() });

export const POST = withJsonErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const rl = await rateLimit("adminLicenseSave", `admin:${admin.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  // No body at all is fine: the note is optional.
  const parsed = Body.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return jsonError(400, { error: "invalid_body", code: "invalid_body" });

  const service = createSupabaseServiceClient();
  const found = await service.from("doctors").select("license_verification_status").eq("id", id).maybeSingle();
  if (found.error && found.error.code !== "PGRST116") {
    console.error("[admin.license.reviewed] read failed", found.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }
  if (!found.data) return jsonError(404, { error: "not_found", code: "not_found" });

  const updated = await service.from("doctors").update({ license_reviewed_at: new Date().toISOString() }).eq("id", id);
  if (updated.error) {
    console.error("[admin.license.reviewed] update failed", updated.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }

  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "admin_license_reviewed",
    target_doctor_id: id,
    metadata: { license_status: found.data.license_verification_status, ...(parsed.data.note ? { note: parsed.data.note } : {}) },
  });
  return jsonOk({ ok: true });
});
