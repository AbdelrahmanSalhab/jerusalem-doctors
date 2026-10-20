// POST /api/admin/doctors/[id]/license/check
//
// Looks a licence number up in the ministry registry and reports what it
// finds. Writes nothing: the admin sees the result first and saves it with a
// separate call, so a typo cannot quietly overwrite a verified licence.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import {
  checkLicense,
  findDuplicate,
  LICENSE_ROW_COLUMNS,
  storedSlot,
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
});

export const POST = withJsonErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const rl = await rateLimit("adminLicenseCheck", `admin:${admin.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const service = createSupabaseServiceClient();
  const found = await service.from("doctors").select(LICENSE_ROW_COLUMNS).eq("id", id).maybeSingle();
  if (found.error && found.error.code !== "PGRST116") {
    console.error("[admin.license.check] read failed", found.error);
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

  let outcome;
  try {
    outcome = await checkLicense(service, {
      slot: body.slot,
      region,
      licenseNumber: body.license_number,
      hebrewFirstName: doctor.hebrew_first_name,
      hebrewFamilyName: doctor.hebrew_family_name,
    });
  } catch (err) {
    // "We could not ask" must never read as "the registry does not have it".
    if (err instanceof MohUnavailableError) {
      return jsonError(503, { error: "moh_unavailable", code: "moh_unavailable" });
    }
    throw err;
  }

  // Told up front, so saving a number another doctor holds is not a surprise
  // 409. The unique constraint stays the authority.
  const duplicate = await findDuplicate(service, id, region, outcome.checkedNumber);

  return jsonOk({
    checked_number: outcome.checkedNumber,
    candidates: outcome.candidates,
    status: outcome.status,
    column_status: outcome.columnStatus,
    source: outcome.source,
    registry: outcome.registry,
    match: outcome.match,
    explanation: outcome.explanation,
    checkable: outcome.checkable,
    duplicate_of: duplicate,
    same_as_stored: stored.number === outcome.checkedNumber && stored.region === region,
    stored_status: stored.status,
  });
});
