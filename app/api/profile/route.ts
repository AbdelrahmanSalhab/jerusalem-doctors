// PATCH /api/profile, partial update of the signed-in doctor's row.
// Server-side whitelist of editable columns. Locked fields (phone, license,
// hebrew name, admin flags) are ignored even if sent. Workplaces are managed
// as a single replace-all set per request, simpler than diffing.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors, zodFields } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { CertificatesSchema, certificatesNormalized } from "@/lib/certificates";
import { CAREER_STAGES, RESIDENCY_YEAR_MIN } from "@/lib/careerStage";
import { rateLimit } from "@/lib/ratelimit";
import { relinkDoctor } from "@/lib/institutions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { WorkplaceInputSchema } from "@/lib/workplace";

const Body = z.object({
  arabic_first_name: z.string().trim().min(2).max(80).optional(),
  arabic_family_name: z.string().trim().min(2).max(80).optional(),
  email: z.email().max(254).optional(),
  subspecialty: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  specialty_ids: z.array(z.uuid()).min(1).max(5).optional(),
  // `.nullable().optional()` is load-bearing: absent means "leave the column
  // alone", explicit null means "write NULL" (طب عام). The form omits both
  // keys entirely for a doctor who has never declared a stage.
  career_stage: z.enum(CAREER_STAGES).nullable().optional(),
  residency_start_year: z
    .number()
    .int()
    .min(RESIDENCY_YEAR_MIN)
    .max(2100)
    .nullable()
    .optional(),
  // Replace-all. Empty is only valid for a resident (checked below, since
  // the stage may come from this request or from the stored row).
  workplaces: z.array(WorkplaceInputSchema).max(20).optional(),
  // Only kept for طب عام; any other stage stores an empty list.
  certificates: CertificatesSchema.optional(),
  seeking_work: z.boolean().optional(),
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
  } catch (e) {
    return jsonError(400, {
      error: "invalid_body",
      code: "invalid_body",
      fields: e instanceof z.ZodError ? zodFields(e) : undefined,
    });
  }

  const stageAfterSave =
    parsed.career_stage !== undefined ? parsed.career_stage : me.career_stage;
  const seekingAfterSave = parsed.seeking_work ?? me.seeking_work;
  if (parsed.workplaces?.length === 0 && stageAfterSave !== "resident" && !seekingAfterSave) {
    return jsonError(400, {
      error: "invalid_body",
      code: "invalid_body",
      fields: { workplaces: "أدخل مكان عمل واحدًا على الأقل" },
    });
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
  if (parsed.career_stage !== undefined) {
    updates.career_stage = parsed.career_stage;
  }
  if (parsed.residency_start_year !== undefined) {
    updates.residency_start_year = parsed.residency_start_year;
  }
  if (parsed.certificates !== undefined) {
    const certificates = parsed.certificates;
    updates.certificates = certificates;
    updates.certificates_normalized = certificatesNormalized(certificates);
  }
  if (parsed.seeking_work !== undefined) {
    updates.seeking_work = parsed.seeking_work;
  }

  // Validate everything before writing anything.
  let workplaceRows: Record<string, unknown>[] | null = null;
  if (parsed.workplaces) {
    const primaries = parsed.workplaces.filter((w) => w.is_primary).length;
    if (parsed.workplaces.length > 0 && primaries !== 1) {
      return jsonError(400, {
        error: "exactly_one_primary",
        code: "exactly_one_primary",
        fields: { workplaces: "يجب أن يكون هناك مكان عمل رئيسي واحد" },
      });
    }
    // Dedupe by normalized name with the primary first, so a duplicate of the
    // primary can't knock it out and leave the doctor with none.
    const seen = new Set<string>();
    workplaceRows = parsed.workplaces
      .map((w, i) => ({
        name: w.name,
        name_normalized: normalizeArabic(w.name),
        workplace_type: w.workplace_type,
        details: w.details,
        address: w.address,
        hours: w.hours,
        phone: w.phone,
        is_primary: w.is_primary,
        sort_order: w.is_primary ? 0 : i + 1,
      }))
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .filter((w) => {
        if (seen.has(w.name_normalized)) return false;
        seen.add(w.name_normalized);
        return true;
      });
  }

  // One transaction (0014): the row, the specialties and the workplaces all
  // save or none do, so a failure can't leave a doctor with an emptied list.
  // null leaves a list untouched.
  const { error } = await service.rpc("save_doctor_profile", {
    p_doctor_id: me.id,
    p_updates: updates,
    // Deduped: a repeated id would hit the link table's key and fail the save.
    p_specialty_ids: parsed.specialty_ids ? [...new Set(parsed.specialty_ids)] : null,
    p_workplaces: workplaceRows,
  });
  if (error) {
    console.error("[profile.patch] save failed", error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }
  // Link the saved workplaces to their hospitals and funds (0016).
  if (workplaceRows) await relinkDoctor(service, me.id);

  return jsonOk({ ok: true });
});

async function requireDoctorOrNull() {
  try {
    return await requireDoctor();
  } catch {
    return null;
  }
}
