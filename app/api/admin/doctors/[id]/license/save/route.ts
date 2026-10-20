// POST /api/admin/doctors/[id]/license/save
//
// Commits a licence number and the verification status that goes with it.
//
// It re-runs the lookup itself rather than trusting a status from the client,
// so what gets stored is always what the registry said a moment ago. If the
// answer has moved since the admin pressed search, it says so instead of
// saving something they did not see.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { writeAudit } from "@/lib/audit";
import {
  adoptableName,
  checkLicense,
  findDuplicate,
  LICENSE_ROW_COLUMNS,
  slotColumns,
  storedSlot,
  toColumnStatus,
  type AdminDoctorLicenseRow,
} from "@/lib/admin/licenseCheck";
import { MohUnavailableError } from "@/lib/moh/match";
import { isValidLicenseFormat, licenseFormatErrorMessage } from "@/lib/normalize/license";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  slot: z.enum(["primary", "secondary"]),
  license_number: z.string().trim().min(1).max(20),
  region: z.enum(["IL", "PS"]).optional(),
  /** What the admin was shown; a mismatch means the answer moved. */
  expected_status: z.string().nullable().optional(),
  /** Store the registry's spelling of the Hebrew name instead of ours, which
   *  is what turns a partial match into a real one. Only for a soft match. */
  adopt_registry_name: z.boolean().optional(),
  override_name_mismatch: z.boolean().optional(),
  reason: z.string().trim().min(3).max(300).optional(),
});

/** Postgres unique violation. Two different constraints can raise it, so the
 *  SQLSTATE is what we match, never a constraint name. */
const UNIQUE_VIOLATION = "23505";

export const POST = withJsonErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const rl = await rateLimit("adminLicenseSave", `admin:${admin.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const service = createSupabaseServiceClient();
  const found = await service.from("doctors").select(LICENSE_ROW_COLUMNS).eq("id", id).maybeSingle();
  if (found.error && found.error.code !== "PGRST116") {
    console.error("[admin.license.save] read failed", found.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }
  if (!found.data) return jsonError(404, { error: "not_found", code: "not_found" });
  const doctor = found.data as unknown as AdminDoctorLicenseRow;

  const stored = storedSlot(doctor, body.slot);
  const region = body.region ?? (stored.region as "IL" | "PS" | null) ?? doctor.license_region;

  if (!isValidLicenseFormat(region, body.license_number)) {
    return jsonError(400, {
      error: "invalid_license",
      code: "invalid_license",
      fields: { license_number: licenseFormatErrorMessage(region, body.license_number) },
    });
  }

  const lookUp = (first: string | null, family: string | null) =>
    checkLicense(service, {
      slot: body.slot,
      region,
      licenseNumber: body.license_number,
      hebrewFirstName: first,
      hebrewFamilyName: family,
    });

  let outcome;
  try {
    outcome = await lookUp(doctor.hebrew_first_name, doctor.hebrew_family_name);
  } catch (err) {
    if (err instanceof MohUnavailableError) {
      return jsonError(503, { error: "moh_unavailable", code: "moh_unavailable" });
    }
    throw err;
  }

  // The registry's answer moved between the search and the save.
  if (body.expected_status !== undefined && body.expected_status !== outcome.columnStatus) {
    return jsonError(409, {
      error: "result_changed",
      code: "result_changed",
    });
  }

  // Taking the registry's spelling of the name. The status is still the
  // matcher's: we swap the name in and ask again, rather than writing the
  // "verified" the client asked for. If that second answer is not an exact
  // match the premise was wrong and nothing is saved.
  let adopted: { first: string; family: string } | null = null;
  if (body.adopt_registry_name) {
    adopted = adoptableName(outcome);
    if (adopted) {
      try {
        const after = await lookUp(adopted.first, adopted.family);
        if (after.status === "verified") outcome = after;
        else adopted = null;
      } catch (err) {
        if (err instanceof MohUnavailableError) {
          return jsonError(503, { error: "moh_unavailable", code: "moh_unavailable" });
        }
        throw err;
      }
    }
    if (!adopted) {
      return jsonError(409, { error: "name_not_adoptable", code: "name_not_adoptable" });
    }
  }

  // The number belongs to someone else in the registry. Storable only once an
  // admin takes responsibility for it, which is the one case name_mismatch
  // has a column at all.
  const overriding = outcome.status === "name_mismatch";
  if (overriding && !(body.override_name_mismatch && body.reason)) {
    return jsonError(409, {
      error: "name_mismatch",
      code: "name_mismatch",
      fields: outcome.registry?.firstName
        ? { license_number: `الرقم يخصّ ${outcome.registry.firstName} ${outcome.registry.familyName ?? ""} في السجل.` }
        : undefined,
    });
  }

  const nextStatus = toColumnStatus(outcome.status, body.override_name_mismatch);
  const numberChanged = stored.number !== outcome.checkedNumber || stored.region !== region;
  const statusChanged = stored.status !== nextStatus;
  const nameChanged =
    adopted !== null &&
    (adopted.first !== doctor.hebrew_first_name || adopted.family !== doctor.hebrew_family_name);

  // Nothing to do. Worth saying rather than writing: a no-op update would
  // still fire the licence-slot trigger.
  if (!numberChanged && !statusChanged && !nameChanged) {
    return jsonOk({ ok: true, changed: false, status: nextStatus, checked_number: outcome.checkedNumber });
  }

  const cols = slotColumns(body.slot);
  const updates: Record<string, unknown> = {
    [cols.number]: outcome.checkedNumber,
    [cols.region]: region,
    [cols.status]: nextStatus,
  };
  // The Hebrew name is the doctor's, not the slot's: the other slot's stored
  // verdict was reached against the old spelling and is not re-run here, the
  // same way an admin's profile edit leaves it to be redone.
  if (nameChanged && adopted) {
    updates.hebrew_first_name = adopted.first;
    updates.hebrew_family_name = adopted.family;
  }
  // Only the primary slot has a verified-at column, and it has always meant
  // "matched approximately or better".
  if (body.slot === "primary") {
    updates.license_verified_at =
      nextStatus === "verified" || nextStatus === "soft_match" ? new Date().toISOString() : null;
  }

  const r = await service.from("doctors").update(updates).eq("id", id);
  if (r.error) {
    if ((r.error as { code?: string }).code === UNIQUE_VIOLATION) {
      const held = (await findDuplicate(service, id, region, outcome.checkedNumber))?.name || null;
      return jsonError(409, {
        error: "duplicate_license",
        code: "duplicate_license",
        fields: {
          license_number: `${outcome.checkedNumber} مسجَّل مسبقًا لطبيب آخر${held ? ` (د. ${held})` : ""}. لا يمكن أن يحمل رقمًا واحدًا طبيبان.`,
        },
      });
    }
    console.error("[admin.license.save] update failed", r.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }

  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: numberChanged ? "admin_license_corrected" : "admin_license_rechecked",
    target_doctor_id: id,
    metadata: {
      slot: body.slot,
      license_number: outcome.checkedNumber,
      ...(numberChanged ? { license_number_before: stored.number, license_number_after: outcome.checkedNumber } : {}),
      license_status_before: stored.status,
      license_status_after: nextStatus,
      source: outcome.source,
      ...(outcome.registry?.firstName ? { registry_first_name: outcome.registry.firstName } : {}),
      ...(outcome.registry?.familyName ? { registry_family_name: outcome.registry.familyName } : {}),
      ...(outcome.match ? { match_first: outcome.match.first, match_family: outcome.match.family } : {}),
      ...(outcome.candidates.length > 1 ? { candidates: outcome.candidates } : {}),
      ...(overriding ? { override_name_mismatch: true } : {}),
      ...(nameChanged && adopted
        ? {
            adopted_registry_name: true,
            hebrew_name_before: `${doctor.hebrew_first_name ?? ""} ${doctor.hebrew_family_name ?? ""}`.trim(),
            hebrew_name_after: `${adopted.first} ${adopted.family}`,
          }
        : {}),
      ...(body.reason ? { reason: body.reason } : {}),
    },
  });

  return jsonOk({
    ok: true,
    changed: true,
    status: nextStatus,
    checked_number: outcome.checkedNumber,
    hebrew_name_changed: nameChanged,
  });
});

