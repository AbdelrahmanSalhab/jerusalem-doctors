// POST /api/admin/doctors/[id]/license/find-by-name
//
// Which registry licences carry this doctor's Hebrew name, for an admin
// fixing a number that was typed wrong. Reads only: whatever the admin picks
// still goes through license/check and license/save, which look the number up
// again. Never offered to the doctor (issue #16: it would hand an impersonator
// the number that goes with a name).

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { findByName } from "@/lib/admin/findByName";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const POST = withJsonErrors(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const rl = await rateLimit("adminLicenseCheck", `admin:${admin.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  const service = createSupabaseServiceClient();
  const found = await service
    .from("doctors")
    .select("id, hebrew_first_name, hebrew_family_name, license_number")
    .eq("id", id)
    .maybeSingle();
  if (found.error && found.error.code !== "PGRST116") {
    console.error("[admin.license.find-by-name] read failed", found.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }
  if (!found.data) return jsonError(404, { error: "not_found", code: "not_found" });

  const hasName = Boolean(found.data.hebrew_first_name?.trim() && found.data.hebrew_family_name?.trim());
  const candidates = await findByName(service, found.data, found.data.license_number);
  return jsonOk({ has_name: hasName, candidates });
});
