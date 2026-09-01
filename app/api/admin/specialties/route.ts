// POST /api/admin/specialties — create a new specialty.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/session";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  name_ar: z.string().trim().min(2).max(120),
  name_he: z.string().trim().max(120).nullable().optional(),
  name_en: z.string().trim().max(120).nullable().optional(),
});

export const POST = withJsonErrors(async (req: Request) => {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const service = createSupabaseServiceClient();

  // Place new entry at the end of the sort order.
  const { data: maxRow } = await service
    .from("specialties")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | null) ?? 0) + 1;

  const r = await service.from("specialties").insert({
    name_ar: body.name_ar,
    name_ar_normalized: normalizeArabic(body.name_ar),
    name_he: body.name_he ?? null,
    name_en: body.name_en ?? null,
    sort_order: nextOrder,
    is_active: true,
  });
  if (r.error) {
    console.error("[admin.specialties.create] failed", r.error);
    return jsonError(500, { error: "create_failed", code: "create_failed" });
  }

  return jsonOk({ ok: true });
});
