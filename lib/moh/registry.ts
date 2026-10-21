// The registry's rows for a licence, folded into the one row we keep per
// licence in `moh_practitioners`.
//
// The registry has one row per specialty certificate: a doctor certified in
// paediatrics and paediatric nephrology has two, and one with none has a
// single row with a blank specialty. Some licences have both a blank row and
// a certificate. Keeping one row per licence lost certificates, and could
// keep the blank one.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import type { MohRecord } from "./client";

export interface RegistryRow {
  license_number: number;
  hebrew_first_name: string;
  hebrew_family_name: string;
  hebrew_first_norm: string;
  hebrew_family_norm: string;
  /** The most recent certificate; null when there is none. */
  specialty_name_he: string | null;
  /** Every certificate, oldest first. */
  specialties: string[];
  license_issued_on: string | null;
  specialist_since: string | null;
  synced_at: string;
}

/** The registry's DDMMYYYY number (22111979) as YYYY-MM-DD, or null. */
export function registryDate(v: number | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).padStart(8, "0");
  const iso = `${s.slice(4)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso) ? iso : null;
}

/** One row per licence, from all the registry rows for it. */
export function toRegistryRows(records: readonly MohRecord[], now = new Date()): RegistryRow[] {
  const byLicense = new Map<number, MohRecord[]>();
  for (const r of records) {
    const lic = r["מספר רישיון רופא"];
    if (!Number.isInteger(lic) || lic <= 0 || !r["שם פרטי"] || !r["שם משפחה"]) continue;
    byLicense.set(lic, [...(byLicense.get(lic) ?? []), r]);
  }
  return [...byLicense].map(([lic, rows]) => {
    const certs = rows
      .map((r) => ({ name: r["שם התמחות"]?.trim() ?? "", on: registryDate(r["תאריך רישום התמחות"]) }))
      .filter((c) => c.name)
      // Undated certificates sort first, so a dated one is "most recent".
      .sort((a, b) => (a.on ?? "").localeCompare(b.on ?? ""));
    const specialties = [...new Set(certs.map((c) => c.name))];
    const first = rows[0];
    return {
      license_number: lic,
      hebrew_first_name: first["שם פרטי"],
      hebrew_family_name: first["שם משפחה"],
      hebrew_first_norm: normalizeHebrew(first["שם פרטי"]),
      hebrew_family_norm: normalizeHebrew(first["שם משפחה"]),
      specialty_name_he: certs.at(-1)?.name ?? null,
      specialties,
      license_issued_on: registryDate(first["תאריך רישום רישיון"]),
      specialist_since: certs.find((c) => c.on)?.on ?? null,
      synced_at: now.toISOString(),
    };
  });
}

export async function saveRegistryRows(service: SupabaseClient, rows: readonly RegistryRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await service.from("moh_practitioners").upsert(rows, { onConflict: "license_number" });
  if (error) throw new Error(`moh_practitioners upsert failed: ${error.message}`);
}
