// Re-checking one doctor's licence against the ministry registry, on demand.
//
// Nothing re-verified a licence after signup, so a doctor recorded as
// not_found on the day they joined stayed not_found for good, even once the
// nightly sync imported the row that would have matched. This is the path an
// admin can take to settle it: look the number up now, see what the registry
// says, and only then decide whether to save.
//
// The lookup and the save share this module so a save can never trust a
// status the client hands it: it re-runs the same check server-side.

import type { SupabaseClient } from "@supabase/supabase-js";
import { explainLicense, type LicenseExplanation } from "@/lib/moh/explain";
import { MohClient } from "@/lib/moh/client";
import { readMirrorFreshness, readMirrorRows } from "@/lib/moh/mirror";
import { resolveIlLicense, type LicenseVerifyStatus, type NameMatch } from "@/lib/moh/match";
import { canonicalLicenseNumber, ilLicenseCandidates } from "@/lib/normalize/license";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import type { LicenseStatusValue } from "@/lib/licenseStatus";

/** An admin is not a signup form waiting on a page, so it can wait longer. */
const ADMIN_LOOKUP = { timeoutMs: 8_000, retries: 1 } as const;

export type LicenseSlot = "primary" | "secondary";

export interface CheckInput {
  slot: LicenseSlot;
  region: "IL" | "PS";
  licenseNumber: string;
  hebrewFirstName: string | null;
  hebrewFamilyName: string | null;
}

export interface CheckOutcome {
  /** The serial that was actually looked up (a typed number can read two ways). */
  checkedNumber: string;
  candidates: string[];
  /** The matcher's own verdict, which includes name_mismatch. */
  status: LicenseVerifyStatus;
  /** What a save would store; null where the matcher's verdict has no column. */
  columnStatus: LicenseStatusValue;
  source: "mirror" | "live" | "none";
  registry: {
    firstName: string | null;
    familyName: string | null;
    specialtyHe: string | null;
  } | null;
  match: NameMatch | null;
  explanation: LicenseExplanation;
  /** False for a licence there is no registry to check. */
  checkable: boolean;
}

/**
 * name_mismatch has no column of its own: it is only storable once a human has
 * accepted it, as name_mismatch_overridden. See licenseStatusToColumn in
 * app/api/signup/start/route.ts, which does the same thing at signup.
 */
export function toColumnStatus(status: LicenseVerifyStatus, overridden = false): LicenseStatusValue {
  switch (status) {
    case "verified":
      return "verified";
    case "soft_match":
      return "soft_match";
    case "not_found":
      return "not_found";
    case "name_mismatch":
      return overridden ? "name_mismatch_overridden" : null;
  }
}

/** A Palestinian licence: there is no registry, so nothing is looked up. */
async function unverifiable(
  service: SupabaseClient,
  input: CheckInput,
  serial: string,
): Promise<CheckOutcome> {
  return {
    checkedNumber: serial,
    candidates: [serial],
    status: "not_found",
    columnStatus: "not_found",
    source: "none",
    registry: null,
    match: null,
    checkable: false,
    explanation: explainLicense({
      status: "not_found",
      region: "PS",
      licenseNumber: serial,
      hebrewFirstName: input.hebrewFirstName,
      hebrewFamilyName: input.hebrewFamilyName,
      registryRow: null,
      mirrorSyncedAt: await readMirrorFreshness(service),
      licenseVerifiedAt: null,
    }),
  };
}

/**
 * Look a licence up now. Throws MohUnavailableError when the registry cannot
 * be reached, so an outage is never reported as "not in the registry".
 */
export async function checkLicense(
  service: SupabaseClient,
  input: CheckInput,
  options: { mohClient?: MohClient } = {},
): Promise<CheckOutcome> {
  if (input.region === "PS") {
    const serial = canonicalLicenseNumber("PS", input.licenseNumber) ?? input.licenseNumber;
    return unverifiable(service, input, serial);
  }

  const candidates = ilLicenseCandidates(input.licenseNumber);
  if (!candidates) throw new Error("checkLicense: unreadable licence number");

  const { serial, result } = await resolveIlLicense(
    service,
    {
      candidates,
      hebrewFirstName: input.hebrewFirstName ?? "",
      hebrewFamilyName: input.hebrewFamilyName ?? "",
    },
    { mohClient: options.mohClient ?? new MohClient(ADMIN_LOOKUP), onLiveError: "throw" },
  );

  const [mirror, syncedAt] = await Promise.all([
    readMirrorRows(service, [serial]),
    readMirrorFreshness(service),
  ]);

  return {
    checkedNumber: serial,
    candidates: [...candidates],
    status: result.status,
    columnStatus: toColumnStatus(result.status),
    source: result.source,
    registry:
      result.registryFirstName || result.registryFamilyName || result.registrySpecialtyHe
        ? {
            firstName: result.registryFirstName ?? null,
            familyName: result.registryFamilyName ?? null,
            specialtyHe: result.registrySpecialtyHe ?? null,
          }
        : null,
    match: result.match ?? null,
    checkable: true,
    explanation: explainLicense({
      // A fresh mismatch is explained as the overridden case would be: the
      // number belongs to someone else in the registry.
      status: result.status === "name_mismatch" ? "name_mismatch_overridden" : toColumnStatus(result.status),
      region: "IL",
      licenseNumber: serial,
      hebrewFirstName: input.hebrewFirstName,
      hebrewFamilyName: input.hebrewFamilyName,
      registryRow: mirror.get(serial) ?? null,
      mirrorSyncedAt: syncedAt,
      licenseVerifiedAt: null,
      match: result.match,
    }),
  };
}

/**
 * The registry's own spelling of the name, when taking it would turn this
 * partial match into an exact one.
 *
 * A soft match is a difference in spelling, not in identity: the number is the
 * registry's and the name is a letter or a space away from it. The only honest
 * way to make such a doctor read "موثّق" is to stop storing the spelling the
 * registry disagrees with — not to overrule the column, which means "matches
 * the registry exactly" everywhere it is read (lib/licenseStatus.ts, the
 * approval gate, the admin stats views).
 *
 * null for every other verdict. A name_mismatch is a different person until a
 * human says otherwise, and adopting the registry's name there would silently
 * rewrite a doctor into whoever holds the number.
 */
export function adoptableName(outcome: CheckOutcome): { first: string; family: string } | null {
  if (outcome.status !== "soft_match") return null;
  const first = normalizeHebrew(outcome.registry?.firstName ?? "");
  const family = normalizeHebrew(outcome.registry?.familyName ?? "");
  return first && family ? { first, family } : null;
}

/** The columns one slot writes. */
export function slotColumns(slot: LicenseSlot) {
  return slot === "primary"
    ? { number: "license_number", region: "license_region", status: "license_verification_status" }
    : {
        number: "secondary_license_number",
        region: "secondary_license_region",
        status: "secondary_license_verification_status",
      };
}

export interface AdminDoctorLicenseRow {
  id: string;
  hebrew_first_name: string | null;
  hebrew_family_name: string | null;
  license_number: string;
  license_region: "IL" | "PS";
  license_verification_status: string | null;
  secondary_license_number: string | null;
  secondary_license_region: "IL" | "PS" | null;
  secondary_license_verification_status: string | null;
}

// One literal, not joined pieces: the typed client reads the row's shape from it.
export const LICENSE_ROW_COLUMNS =
  "id, hebrew_first_name, hebrew_family_name, license_number, license_region, license_verification_status, secondary_license_number, secondary_license_region, secondary_license_verification_status";

/** What one slot currently holds. */
export function storedSlot(doctor: AdminDoctorLicenseRow, slot: LicenseSlot) {
  const cols = slotColumns(slot);
  const row = doctor as unknown as Record<string, string | null>;
  return { number: row[cols.number], region: row[cols.region], status: row[cols.status] };
}

/** The other doctor holding this (region, number), if there is one. Checked up
 *  front so saving a number someone else has is not a surprise 409; the unique
 *  constraint on doctor_license_slots stays the authority. */
export async function findDuplicate(
  service: SupabaseClient,
  doctorId: string,
  region: string,
  number: string,
): Promise<{ id: string; name: string } | null> {
  const { data } = await service
    .from("doctor_license_slots")
    .select("doctor_id, doctor:doctors!inner(arabic_first_name, arabic_family_name)")
    .eq("license_region", region)
    .eq("license_number", number)
    .neq("doctor_id", doctorId)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    doctor_id: string;
    doctor:
      | { arabic_first_name: string; arabic_family_name: string }
      | { arabic_first_name: string; arabic_family_name: string }[]
      | null;
  };
  const d = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
  return { id: row.doctor_id, name: d ? `${d.arabic_first_name} ${d.arabic_family_name}` : "" };
}
