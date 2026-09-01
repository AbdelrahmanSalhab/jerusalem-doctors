// PATCH /api/profile — partial update of the signed-in doctor's row.
// Server-side whitelist of editable columns. Locked fields (phone, license,
// hebrew name, admin flags) are ignored even if sent. Workplaces are managed
// as a single replace-all set per request — simpler than diffing.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  arabic_first_name: z.string().trim().min(2).max(80).optional(),
  arabic_family_name: z.string().trim().min(2).max(80).optional(),
  email: z.email().optional(),
  subspecialty: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  specialty_ids: z.array(z.uuid()).min(1).max(5).optional(),
  workplaces: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(120),
        workplace_type: z.enum(["hospital", "clinic"]).default("hospital"),
        details: z.string().trim().max(300).nullable().optional(),
        is_primary: z.boolean(),
      }),
    )
    .min(1)
    .max(20)
    .optional(),
  phone_is_visible: z.boolean().optional(),
  workplaces_is_visible: z.boolean().optional(),
});

export const PATCH = withJsonErrors(async (req: Request) => {
  const me = await requireDoctorOrNull();
  if (!me) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const rl = await rateLimit("profilePatch", `doctor:${me.id}`);
  if (!rl.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const service = createSupabaseServiceClient();

  const updates: Record<string, unknown> = {};
  if (parsed.arabic_first_name !== undefined) {
    updates.arabic_first_name = parsed.arabic_first_name;
    updates.arabic_first_name_normalized = normalizeArabic(
      parsed.arabic_first_name,
    );
  }
  if (parsed.arabic_family_name !== undefined) {
    updates.arabic_family_name = parsed.arabic_family_name;
    updates.arabic_family_name_normalized = normalizeArabic(
      parsed.arabic_family_name,
    );
  }
  if (parsed.arabic_first_name !== undefined || parsed.arabic_family_name !== undefined) {
    const f = parsed.arabic_first_name ?? me.arabic_first_name;
    const l = parsed.arabic_family_name ?? me.arabic_family_name;
    updates.arabic_full_name_normalized = normalizeArabic(`${f} ${l}`);
  }
  if (parsed.email !== undefined) {
    updates.email = parsed.email;
  }
  if (parsed.subspecialty !== undefined) {
    updates.subspecialty = parsed.subspecialty || null;
    updates.subspecialty_normalized = parsed.subspecialty
      ? normalizeArabic(parsed.subspecialty)
      : null;
  }
  if (parsed.bio !== undefined) {
    updates.bio = parsed.bio || null;
  }
  if (parsed.phone_is_visible !== undefined) {
    updates.phone_is_visible = parsed.phone_is_visible;
  }
  if (parsed.workplaces_is_visible !== undefined) {
    updates.workplaces_is_visible = parsed.workplaces_is_visible;
  }

  if (Object.keys(updates).length > 0) {
    const r = await service.from("doctors").update(updates).eq("id", me.id);
    if (r.error) {
      console.error("[profile.patch] doctor update failed", r.error);
      return jsonError(500, {
        error: "update_failed",
        code: "update_failed",
      });
    }
  }

  if (parsed.specialty_ids) {
    // Replace-all: clear old links, insert the new set.
    await service.from("doctor_specialties").delete().eq("doctor_id", me.id);
    if (parsed.specialty_ids.length > 0) {
      const r = await service.from("doctor_specialties").insert(
        parsed.specialty_ids.map((sid) => ({
          doctor_id: me.id,
          specialty_id: sid,
        })),
      );
      if (r.error) {
        console.error("[profile.patch] specialty replace failed", r.error);
        return jsonError(500, {
          error: "specialty_update_failed",
          code: "specialty_update_failed",
        });
      }
    }
  }

  if (parsed.workplaces) {
    // Validate exactly one primary.
    const primaries = parsed.workplaces.filter((w) => w.is_primary).length;
    if (primaries !== 1) {
      return jsonError(400, {
        error: "exactly_one_primary",
        code: "exactly_one_primary",
        fields: { workplaces: "يجب أن يكون هناك مكان عمل رئيسي واحد" },
      });
    }

    const seen = new Set<string>();
    const rows = parsed.workplaces
      .map((w, i) => ({
        doctor_id: me.id,
        name: w.name,
        name_normalized: normalizeArabic(w.name),
        workplace_type: w.workplace_type,
        details: w.details?.trim() || null,
        is_primary: w.is_primary,
        sort_order: w.is_primary ? 0 : i + 1,
      }))
      .filter((w) => {
        if (seen.has(w.name_normalized)) return false;
        seen.add(w.name_normalized);
        return true;
      });

    await service.from("doctor_workplaces").delete().eq("doctor_id", me.id);
    const r = await service.from("doctor_workplaces").insert(rows);
    if (r.error) {
      console.error("[profile.patch] workplaces replace failed", r.error);
      return jsonError(500, {
        error: "workplaces_update_failed",
        code: "workplaces_update_failed",
      });
    }
  }

  return jsonOk({ ok: true });
});

async function requireDoctorOrNull() {
  try {
    return await requireDoctor();
  } catch {
    return null;
  }
}
