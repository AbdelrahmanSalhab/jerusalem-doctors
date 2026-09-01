// License-verification matcher (plan §13).
//
// Inputs:  user-typed license number + Hebrew first/family name.
// Source:  local `moh_practitioners` mirror (synced daily) + live CKAN
//          fallback for licenses issued after the last snapshot.
// Output:  one of four discrete statuses, with the registry's own spelling
//          included on mismatches so the UI can prompt "did you mean…?".

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import { MohClient } from "./client";

export type LicenseVerifyStatus =
  | "verified"
  | "soft_match"
  | "name_mismatch"
  | "not_found";

export interface LicenseVerifyInput {
  licenseNumber: number;
  hebrewFirstName: string;
  hebrewFamilyName: string;
}

export interface LicenseVerifyResult {
  status: LicenseVerifyStatus;
  registryFirstName?: string;
  registryFamilyName?: string;
  registrySpecialtyHe?: string | null;
  source: "mirror" | "live" | "none";
}

interface MirrorRow {
  license_number: number;
  hebrew_first_name: string;
  hebrew_family_name: string;
  hebrew_first_norm: string;
  hebrew_family_norm: string;
  specialty_name_he: string | null;
}

/**
 * Conservative similarity check. We treat exact match plus single-edit and
 * substring-of as "close enough" to ask the user to confirm the registry's
 * spelling — *not* enough to auto-approve. Anything else is a mismatch.
 */
function closeEnough(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return levenshtein(a, b) <= 1;
}

/** Government CSV exports sometimes use a whitespace-only string for
 * "no specialty" instead of a real null — treat that the same as null so it
 * doesn't get misread as "this doctor holds a specialization certificate". */
function cleanSpecialty(s: string | null | undefined): string | null {
  const trimmed = s?.trim();
  return trimmed ? trimmed : null;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}

/**
 * Verify (license, Hebrew name) against the MoH registry.
 * Pure of UI concerns; the API route translates the status into Arabic copy.
 */
export async function verifyLicense(
  supabase: SupabaseClient,
  input: LicenseVerifyInput,
  options: { mohClient?: MohClient } = {},
): Promise<LicenseVerifyResult> {
  const inputFirst = normalizeHebrew(input.hebrewFirstName);
  const inputFamily = normalizeHebrew(input.hebrewFamilyName);

  // 1) Try the local mirror first.
  const mirror = await supabase
    .from("moh_practitioners")
    .select(
      "license_number, hebrew_first_name, hebrew_family_name, hebrew_first_norm, hebrew_family_norm, specialty_name_he",
    )
    .eq("license_number", input.licenseNumber)
    .maybeSingle();

  if (mirror.error && mirror.error.code !== "PGRST116") {
    throw new Error(`moh_practitioners read failed: ${mirror.error.message}`);
  }

  if (mirror.data) {
    return compareNames(mirror.data, inputFirst, inputFamily, "mirror");
  }

  // 2) Fallback to live CKAN (handles freshly issued licenses).
  const client = options.mohClient ?? new MohClient();
  const live = await client.findByLicense(input.licenseNumber);
  if (!live) return { status: "not_found", source: "none" };

  const liveRow: MirrorRow = {
    license_number: live["מספר רישיון רופא"],
    hebrew_first_name: live["שם פרטי"],
    hebrew_family_name: live["שם משפחה"],
    hebrew_first_norm: normalizeHebrew(live["שם פרטי"]),
    hebrew_family_norm: normalizeHebrew(live["שם משפחה"]),
    specialty_name_he: live["שם התמחות"] ?? null,
  };

  return compareNames(liveRow, inputFirst, inputFamily, "live");
}

function compareNames(
  row: MirrorRow,
  inputFirstNorm: string,
  inputFamilyNorm: string,
  source: "mirror" | "live",
): LicenseVerifyResult {
  const specialty = cleanSpecialty(row.specialty_name_he);

  const exact =
    inputFirstNorm === row.hebrew_first_norm &&
    inputFamilyNorm === row.hebrew_family_norm;

  if (exact) {
    return {
      status: "verified",
      registrySpecialtyHe: specialty,
      source,
    };
  }

  const close =
    closeEnough(inputFirstNorm, row.hebrew_first_norm) &&
    closeEnough(inputFamilyNorm, row.hebrew_family_norm);

  if (close) {
    return {
      status: "soft_match",
      registryFirstName: row.hebrew_first_name,
      registryFamilyName: row.hebrew_family_name,
      registrySpecialtyHe: specialty,
      source,
    };
  }

  // Even on a name mismatch, we've still matched the license *number* to a
  // real row — keep the specialty so a human-confirmed override (see
  // signup/start's override_name_mismatch flow) doesn't lose the career
  // stage signal.
  return {
    status: "name_mismatch",
    registryFirstName: row.hebrew_first_name,
    registryFamilyName: row.hebrew_family_name,
    registrySpecialtyHe: specialty,
    source,
  };
}
