// Saving a doctor's profile: the rules, the normalized columns, and the one
// transaction that writes them.
//
// Two routes save a profile — the doctor's own /api/profile and an admin's
// /api/admin/doctors/[id]/profile — and they must agree on every rule, or a
// doctor and an admin editing the same field get different answers. The
// schema, the workplace rules and the column building live here; each route
// keeps only what is genuinely its own (who may call it, and the identity
// fields only an admin may touch).

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAREER_STAGES, RESIDENCY_YEAR_MIN } from "@/lib/careerStage";
import { CertificatesSchema, certificatesNormalized } from "@/lib/certificates";
import { relinkDoctor } from "@/lib/institutions";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { WorkplaceInputSchema } from "@/lib/workplace";

export const ProfileFieldsSchema = z.object({
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

export type ProfileFields = z.infer<typeof ProfileFieldsSchema>;

/** The admin form reaches the identity fields a doctor cannot change for
 *  themselves. The phone arrives raw and is normalized by the route, which
 *  also has to move the login that hangs off it. */
export const AdminProfileFieldsSchema = ProfileFieldsSchema.extend({
  hebrew_first_name: z.string().trim().max(80).nullable().optional(),
  hebrew_family_name: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().min(1).max(30).optional(),
  is_phone_verified: z.boolean().optional(),
  /** A second submit, acknowledging a number that cannot receive an OTP. */
  confirm_phone_risk: z.boolean().optional(),
});

export type AdminProfileFields = z.infer<typeof AdminProfileFieldsSchema>;

/** What a route answers with when a rule refuses the save. */
export interface SaveFailure {
  status: number;
  code: string;
  fields?: Record<string, string>;
}

/** The stored row, for the rules that need more than the request. */
export interface ProfileCurrent {
  arabic_first_name: string;
  arabic_family_name: string;
  career_stage: "resident" | "specialist" | null;
  seeking_work: boolean;
}

/**
 * A doctor may list no workplace only while they are a resident or looking
 * for one. The stage may come from this request or from the stored row.
 */
export function workplacesRuleFailure(
  p: ProfileFields,
  current: Pick<ProfileCurrent, "career_stage" | "seeking_work">,
): SaveFailure | null {
  const stageAfterSave = p.career_stage !== undefined ? p.career_stage : current.career_stage;
  const seekingAfterSave = p.seeking_work ?? current.seeking_work;
  if (p.workplaces?.length === 0 && stageAfterSave !== "resident" && !seekingAfterSave) {
    return {
      status: 400,
      code: "invalid_body",
      fields: { workplaces: "أدخل مكان عمل واحدًا على الأقل" },
    };
  }
  return null;
}

/** The doctor columns this request changes, with every `*_normalized` twin
 *  recomputed. `current` supplies the half of a name the request omitted. */
export function buildProfileUpdates(
  p: ProfileFields,
  current: Pick<ProfileCurrent, "arabic_first_name" | "arabic_family_name">,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (p.arabic_first_name !== undefined) {
    updates.arabic_first_name = p.arabic_first_name;
    updates.arabic_first_name_normalized = normalizeArabic(p.arabic_first_name);
  }
  if (p.arabic_family_name !== undefined) {
    updates.arabic_family_name = p.arabic_family_name;
    updates.arabic_family_name_normalized = normalizeArabic(p.arabic_family_name);
  }
  if (p.arabic_first_name !== undefined || p.arabic_family_name !== undefined) {
    const f = p.arabic_first_name ?? current.arabic_first_name;
    const l = p.arabic_family_name ?? current.arabic_family_name;
    updates.arabic_full_name_normalized = normalizeArabic(`${f} ${l}`);
  }
  if (p.email !== undefined) {
    updates.email = p.email;
  }
  if (p.subspecialty !== undefined) {
    updates.subspecialty = p.subspecialty || null;
    updates.subspecialty_normalized = p.subspecialty ? normalizeArabic(p.subspecialty) : null;
  }
  if (p.bio !== undefined) {
    updates.bio = p.bio || null;
  }
  if (p.career_stage !== undefined) {
    updates.career_stage = p.career_stage;
  }
  if (p.residency_start_year !== undefined) {
    updates.residency_start_year = p.residency_start_year;
  }
  if (p.certificates !== undefined) {
    updates.certificates = p.certificates;
    updates.certificates_normalized = certificatesNormalized(p.certificates);
  }
  if (p.seeking_work !== undefined) {
    updates.seeking_work = p.seeking_work;
  }
  return updates;
}

/**
 * The replace-all workplace set, validated before anything is written.
 * Deduped by normalized name with the primary first, so a duplicate of the
 * primary can't knock it out and leave the doctor with none.
 */
export function buildWorkplaceRows(
  workplaces: ProfileFields["workplaces"],
): { rows: Record<string, unknown>[] } | { error: SaveFailure } {
  if (!workplaces) return { rows: [] };
  const primaries = workplaces.filter((w) => w.is_primary).length;
  if (workplaces.length > 0 && primaries !== 1) {
    return {
      error: {
        status: 400,
        code: "exactly_one_primary",
        fields: { workplaces: "يجب أن يكون هناك مكان عمل رئيسي واحد" },
      },
    };
  }
  const seen = new Set<string>();
  const rows = workplaces
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
  return { rows };
}

/** Postgres unique violation. Several constraints can raise it, so the
 *  SQLSTATE is what we match, never a constraint name. */
export const UNIQUE_VIOLATION = "23505";

export interface SaveProfileResult {
  /** Null on success. */
  failure: SaveFailure | null;
  /** True when the write was refused by a unique constraint, so the caller
   *  can say which value collided. */
  duplicate: boolean;
}

/**
 * One transaction (0014, widened in 0018): the row, the specialties and the
 * workplaces all save or none do, so a failure can't leave a doctor with an
 * emptied list. null leaves a list untouched.
 */
export async function saveProfileTransaction(
  service: SupabaseClient,
  doctorId: string,
  args: {
    updates: Record<string, unknown>;
    specialtyIds: string[] | null;
    workplaceRows: Record<string, unknown>[] | null;
  },
  logPrefix: string,
): Promise<SaveProfileResult> {
  const { error } = await service.rpc("save_doctor_profile", {
    p_doctor_id: doctorId,
    p_updates: args.updates,
    // Deduped: a repeated id would hit the link table's key and fail the save.
    p_specialty_ids: args.specialtyIds ? [...new Set(args.specialtyIds)] : null,
    p_workplaces: args.workplaceRows,
  });
  if (error) {
    const duplicate = (error as { code?: string }).code === UNIQUE_VIOLATION;
    if (!duplicate) console.error(`[${logPrefix}] save failed`, error);
    return {
      duplicate,
      failure: { status: duplicate ? 409 : 500, code: duplicate ? "duplicate" : "update_failed" },
    };
  }
  // Link the saved workplaces to their hospitals and funds (0016).
  if (args.workplaceRows) await relinkDoctor(service, doctorId);
  return { failure: null, duplicate: false };
}
