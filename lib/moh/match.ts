// License-verification matcher (plan §13).
//
// Inputs:  user-typed license number + Hebrew first/family name.
// Source:  `moh_practitioners`, our copy of the registry (refreshed weekly in
//          full, nightly for our doctors), then one live CKAN request for a
//          licence issued since, whose answer is kept there so the next check
//          of the same licence costs nothing.
// Output:  one of four discrete statuses, with the registry's own spelling
//          included on mismatches so the UI can prompt "did you mean…?".

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import { MohClient } from "./client";
import { saveRegistryRows, toRegistryRows, type RegistryRow } from "./registry";

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

/** How a typed name compares to the registry's spelling of it. */
export type NameMatchRule = "exact" | "substring" | "edit1" | "none";

export interface NameMatch {
  first: NameMatchRule;
  family: NameMatchRule;
}

export interface LicenseVerifyResult {
  status: LicenseVerifyStatus;
  registryFirstName?: string;
  registryFamilyName?: string;
  registrySpecialtyHe?: string | null;
  source: "mirror" | "live" | "none";
  /** Present whenever a registry row was found, absent for not_found. */
  match?: NameMatch;
}

/**
 * The registry could not be reached. Signup swallows this into not_found so a
 * data.gov.il outage can never fail a signup, but an admin re-checking a
 * licence needs it distinguishable: "not in the registry" and "we could not
 * ask the registry" are very different answers to give about a doctor.
 */
export class MohUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("MoH registry lookup failed");
    this.name = "MohUnavailableError";
    this.cause = cause;
  }
}

export interface VerifyOptions {
  mohClient?: MohClient;
  /** Default "not_found" keeps signup's behaviour. */
  onLiveError?: "not_found" | "throw";
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
 * Which of the similarity rules a pair of names satisfies, or "none".
 *
 * The rules themselves are unchanged and still conservative: exact match,
 * substring-of either way, or a single edit is "close enough" to ask the user
 * to confirm the registry's spelling, *not* enough to auto-approve. Naming the
 * rule instead of returning a bare boolean is what lets /admin tell an admin
 * **why** a doctor came out as a partial match rather than just that they did.
 */
export function nameMatchRule(a: string, b: string): NameMatchRule {
  if (!a || !b) return "none";
  if (a === b) return "exact";
  if (a.includes(b) || b.includes(a)) return "substring";
  return levenshtein(a, b) <= 1 ? "edit1" : "none";
}

function closeEnough(a: string, b: string): boolean {
  return nameMatchRule(a, b) !== "none";
}

/** Government CSV exports sometimes use a whitespace-only string for
 * "no specialty" instead of a real null, treat that the same as null so it
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

/** The live fallback runs while a doctor waits on the form. */
const LIVE_LOOKUP = { timeoutMs: 5_000, retries: 0 } as const;

/**
 * Verify (license, Hebrew name) against the MoH registry.
 * Pure of UI concerns; the API route translates the status into Arabic copy.
 */
export async function verifyLicense(
  supabase: SupabaseClient,
  input: LicenseVerifyInput,
  options: VerifyOptions = {},
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

  // 2) Fallback to live CKAN (handles freshly issued licenses). A doctor is
  // waiting on this, so it gets one short try: data.gov.il being down or
  // blocking us must not fail the signup. It lands in admin review instead,
  // the same as a license the registry doesn't know.
  const client = options.mohClient ?? new MohClient(LIVE_LOOKUP);
  let liveRow: RegistryRow | undefined;
  try {
    [liveRow] = toRegistryRows(await client.findByLicenses([input.licenseNumber]));
  } catch (err) {
    if (options.onLiveError === "throw") throw new MohUnavailableError(err);
    console.error("[moh] live registry lookup failed, treating as not_found", err);
    return { status: "not_found", source: "none" };
  }
  if (!liveRow) return { status: "not_found", source: "none" };

  // Kept for the rest of this signup (check-license, then start) and for an
  // admin opening the doctor. Failing to keep it costs a request, not a signup.
  await saveRegistryRows(supabase, [liveRow]).catch((err) => console.error("[moh] could not keep the registry row", err));
  return compareNames(liveRow, inputFirst, inputFamily, "live");
}

function compareNames(
  row: MirrorRow,
  inputFirstNorm: string,
  inputFamilyNorm: string,
  source: "mirror" | "live",
): LicenseVerifyResult {
  const specialty = cleanSpecialty(row.specialty_name_he);

  const match: NameMatch = {
    first: nameMatchRule(inputFirstNorm, row.hebrew_first_norm),
    family: nameMatchRule(inputFamilyNorm, row.hebrew_family_norm),
  };

  const exact = match.first === "exact" && match.family === "exact";

  if (exact) {
    return {
      status: "verified",
      registrySpecialtyHe: specialty,
      source,
      match,
    };
  }

  const close = closeEnough(inputFirstNorm, row.hebrew_first_norm) && closeEnough(inputFamilyNorm, row.hebrew_family_norm);

  if (close) {
    return {
      status: "soft_match",
      registryFirstName: row.hebrew_first_name,
      registryFamilyName: row.hebrew_family_name,
      registrySpecialtyHe: specialty,
      source,
      match,
    };
  }

  // Even on a name mismatch, we've still matched the license *number* to a
  // real row, keep the specialty so a human-confirmed override (see
  // signup/start's override_name_mismatch flow) doesn't lose the career
  // stage signal.
  return {
    status: "name_mismatch",
    registryFirstName: row.hebrew_first_name,
    registryFamilyName: row.hebrew_family_name,
    registrySpecialtyHe: specialty,
    source,
    match,
  };
}

/** Best first. A name match beats a bare hit on the number, and any hit
 *  beats a number the registry doesn't know. */
const STATUS_RANK: Record<LicenseVerifyStatus, number> = {
  verified: 0,
  soft_match: 1,
  name_mismatch: 2,
  not_found: 3,
};

export interface ResolvedIlLicense {
  /** The registry serial the result belongs to; what gets stored. */
  serial: string;
  result: LicenseVerifyResult;
}

/**
 * Verify each reading from ilLicenseCandidates() in order and keep the best,
 * preferring the earlier (more literal) reading on a tie. Stops at the first
 * `verified`, so an unambiguous number still costs one lookup.
 */
export async function resolveIlLicense(
  supabase: SupabaseClient,
  input: {
    candidates: readonly string[];
    hebrewFirstName: string;
    hebrewFamilyName: string;
  },
  options: VerifyOptions = {},
): Promise<ResolvedIlLicense> {
  let best: ResolvedIlLicense | null = null;
  for (const serial of input.candidates) {
    const result = await verifyLicense(
      supabase,
      {
        licenseNumber: Number(serial),
        hebrewFirstName: input.hebrewFirstName,
        hebrewFamilyName: input.hebrewFamilyName,
      },
      options,
    );
    if (!best || STATUS_RANK[result.status] < STATUS_RANK[best.result.status]) {
      best = { serial, result };
    }
    if (result.status === "verified") break;
  }
  if (!best) throw new Error("resolveIlLicense: no candidates");
  return best;
}
