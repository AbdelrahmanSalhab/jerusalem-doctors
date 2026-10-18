// POST /api/admin/institutions: add an institution (0016), then re-link
// every workplace so existing rows that match it are claimed at once.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors, zodFields } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/session";
import { INSTITUTION_KINDS, relinkWorkplaces } from "@/lib/institutions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const InstitutionBody = z.object({
  name_ar: z.string().trim().min(2).max(120),
  name_he: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
  kind: z.enum(INSTITUTION_KINDS),
  aliases: z.array(z.string().trim().min(2).max(120)).max(40).default([]),
});

export const POST = withJsonErrors(async (req: Request) => {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const parsed = InstitutionBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, { error: "invalid_body", code: "invalid_body", fields: zodFields(parsed.error) });
  }
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("institutions").insert(parsed.data).select("id").single();
  if (error) {
    if (error.code === "23505") {
      return jsonError(409, { error: "duplicate", code: "duplicate", fields: { name_ar: "هذا الاسم موجود في القائمة." } });
    }
    throw error;
  }
  const { changed } = await relinkWorkplaces(service);
  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "institution_created",
    metadata: { id: data.id, name_ar: parsed.data.name_ar, linked: changed },
  });
  return jsonOk({ ok: true, id: data.id, linked: changed });
});
