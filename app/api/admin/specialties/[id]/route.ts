// PATCH /api/admin/specialties/[id] — rename, reorder, or toggle active.

import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/session";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  name_ar: z.string().trim().min(2).max(120).optional(),
  name_he: z.string().trim().max(120).nullable().optional(),
  name_en: z.string().trim().max(120).nullable().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin().catch(() => null);
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

  const updates: Record<string, unknown> = { ...body };
  if (body.name_ar !== undefined) {
    updates.name_ar_normalized = normalizeArabic(body.name_ar);
  }
  if (Object.keys(updates).length === 0) {
    return jsonError(400, { error: "no_fields", code: "no_fields" });
  }

  const service = createSupabaseServiceClient();
  const r = await service.from("specialties").update(updates).eq("id", id);
  if (r.error) {
    console.error("[admin.specialties.patch] failed", r.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }

  await service.from("audit_logs").insert({
    actor_doctor_id: admin.id,
    action: "specialty_updated",
    metadata: { specialty_id: id, ...body },
  });

  return jsonOk({ ok: true });
}
