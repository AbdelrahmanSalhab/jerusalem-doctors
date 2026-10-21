// Reads of `moh_practitioners`, the registry rows we have looked up (our
// doctors' licences and recent signups'), for showing an admin what
// the registry actually says about a licence.
//
// Separate from match.ts on purpose: the matcher answers "does this name fit
// this number", while /admin also needs the registry row itself (its spelling,
// its specialty, when we last synced) to explain a verdict. The licence number
// is the table's primary key, so these are cheap enough to run on a page
// render, which the live CKAN lookup is not.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface MirrorPractitioner {
  licenseNumber: number;
  hebrewFirstName: string;
  hebrewFamilyName: string;
  hebrewFirstNorm: string;
  hebrewFamilyNorm: string;
  specialtyHe: string | null;
  /** Every specialty certificate, oldest first. */
  specialties: string[];
  /** YYYY-MM-DD. */
  licenseIssuedOn: string | null;
  specialistSince: string | null;
  syncedAt: string;
}

const COLUMNS =
  "license_number, hebrew_first_name, hebrew_family_name, hebrew_first_norm, hebrew_family_norm, specialty_name_he, specialties, license_issued_on, specialist_since, synced_at";

interface MirrorRow {
  license_number: number;
  hebrew_first_name: string;
  hebrew_family_name: string;
  hebrew_first_norm: string;
  hebrew_family_norm: string;
  specialty_name_he: string | null;
  specialties: string[] | null;
  license_issued_on: string | null;
  specialist_since: string | null;
  synced_at: string;
}

function toPractitioner(row: MirrorRow): MirrorPractitioner {
  return {
    licenseNumber: row.license_number,
    hebrewFirstName: row.hebrew_first_name,
    hebrewFamilyName: row.hebrew_family_name,
    hebrewFirstNorm: row.hebrew_first_norm,
    hebrewFamilyNorm: row.hebrew_family_norm,
    specialtyHe: row.specialty_name_he?.trim() || null,
    specialties: row.specialties ?? [],
    licenseIssuedOn: row.license_issued_on,
    specialistSince: row.specialist_since,
    syncedAt: row.synced_at,
  };
}

/**
 * The mirror rows for a set of licence serials, keyed by serial as a string
 * (which is how doctors.license_number stores it). Non-numeric serials are
 * dropped: a Palestinian licence has no row to find.
 */
export async function readMirrorRows(
  service: SupabaseClient,
  serials: readonly string[],
): Promise<Map<string, MirrorPractitioner>> {
  const numbers = [...new Set(serials.map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0))];
  if (numbers.length === 0) return new Map();

  const { data, error } = await service.from("moh_practitioners").select(COLUMNS).in("license_number", numbers);
  if (error) throw new Error(`moh_practitioners read failed: ${error.message}`);

  const out = new Map<string, MirrorPractitioner>();
  for (const row of (data ?? []) as MirrorRow[]) {
    out.set(String(row.license_number), toPractitioner(row));
  }
  return out;
}

/**
 * When the mirror was last refreshed, so the panel can say "not in the copy we
 * have, last synced …" instead of claiming the registry itself is missing a
 * licence. Read from the sync's audit entry rather than by sorting rows on an
 * unindexed `synced_at`.
 */
export async function readMirrorFreshness(service: SupabaseClient): Promise<string | null> {
  const { data, error } = await service
    .from("audit_logs")
    .select("created_at")
    .eq("action", "moh_sync_completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A missing sync entry is not worth failing a page render over.
  if (error && error.code !== "PGRST116") return null;
  return (data?.created_at as string | undefined) ?? null;
}
