// PATCH /api/admin/institutions/[id]: edit an institution, or add one
// spelling to it ({ add_alias }), which is how an unmatched name is claimed.
// DELETE removes it; its workplaces fall back to unlinked (on delete set null).
// Both re-link every workplace and write to the audit log.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors, zodFields } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { institutionsChanged } from "@/lib/cachedReads";
import { INSTITUTION_KINDS, relinkWorkplaces } from "@/lib/institutions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Patch = z.union([
  z.object({ add_alias: z.string().trim().min(2).max(120) }).strict(),
  z
    .object({
      name_ar: z.string().trim().min(2).max(120).optional(),
      name_he: z.string().trim().max(120).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
      kind: z.enum(INSTITUTION_KINDS).optional(),
      aliases: z.array(z.string().trim().min(2).max(120)).max(40).optional(),
    })
    .strict(),
]);

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withJsonErrors(async (req: Request, ctx: Ctx) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, { error: "invalid_body", code: "invalid_body", fields: zodFields(parsed.error) });
  }
  const service = createSupabaseServiceClient();
  const found = await service.from("institutions").select("aliases").eq("id", id).maybeSingle();
  if (found.error) throw found.error;
  if (!found.data) return jsonError(404, { error: "not_found", code: "not_found" });

  const body = parsed.data;
  const update =
    "add_alias" in body
      ? { aliases: [...new Set([...(found.data.aliases as string[]), body.add_alias])] }
      : Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  const r = await service.from("institutions").update(update).eq("id", id);
  if (r.error) {
    if (r.error.code === "23505") {
      return jsonError(409, { error: "duplicate", code: "duplicate", fields: { name_ar: "هذا الاسم موجود في القائمة." } });
    }
    throw r.error;
  }
  institutionsChanged();
  const { changed, unmatched } = await relinkWorkplaces(service);
  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "institution_updated",
    metadata: { id, ...update, linked: changed },
  });
  // Lets the page say so when a claimed name still didn't link.
  const stillUnlinked = "add_alias" in body && unmatched.some((u) => u.name === body.add_alias);
  return jsonOk({ ok: true, linked: changed, still_unlinked: stillUnlinked });
});

export const DELETE = withJsonErrors(async (_req: Request, ctx: Ctx) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  const service = createSupabaseServiceClient();
  const r = await service.from("institutions").delete().eq("id", id).select("name_ar").maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) return jsonError(404, { error: "not_found", code: "not_found" });
  institutionsChanged();
  const { changed } = await relinkWorkplaces(service);
  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "institution_deleted",
    metadata: { id, name_ar: r.data.name_ar, relinked: changed },
  });
  return jsonOk({ ok: true });
});
