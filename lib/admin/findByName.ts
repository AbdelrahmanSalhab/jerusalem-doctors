// Finding the licence a doctor probably meant, by name, for an admin.
//
// A number typed wrong at signup reads "not found" and stays that way; the
// registry copy can say who holds a licence under this name. This only
// proposes: a name is not an identity, so nothing here writes, and the admin
// still confirms with the doctor and saves through the usual check, which
// looks the number up again on the server.
//
// Admin-only on purpose. Offered to a person typing their own signup it would
// hand an impersonator the number to go with a name (issue #16).

import type { SupabaseClient } from "@supabase/supabase-js";
import { levenshtein } from "@/lib/moh/match";
import { normalizeHebrew } from "@/lib/normalize/hebrew";

/** Same family name, other first name: shown, but a weaker lead. */
const FAMILY_LIMIT = 8;

export interface NameCandidate {
  licenseNumber: string;
  firstName: string;
  familyName: string;
  specialtyHe: string | null;
  /** Both names equal; the two names the wrong way round; or only the family name. */
  kind: "exact" | "swapped" | "family";
  /** Digits that differ from the number we hold; small means a typo. */
  distance: number | null;
  /** The doctor of ours who already holds this number, if any. */
  heldBy: { id: string; name: string } | null;
}

interface Row {
  license_number: number;
  hebrew_first_name: string;
  hebrew_family_name: string;
  hebrew_first_norm: string;
  hebrew_family_norm: string;
  specialty_name_he: string | null;
}

export async function findByName(
  service: SupabaseClient,
  doctor: { id: string; hebrew_first_name: string | null; hebrew_family_name: string | null },
  storedNumber: string,
): Promise<NameCandidate[]> {
  const first = normalizeHebrew(doctor.hebrew_first_name ?? "");
  const family = normalizeHebrew(doctor.hebrew_family_name ?? "");
  if (!first || !family) return [];

  const columns =
    "license_number, hebrew_first_name, hebrew_family_name, hebrew_first_norm, hebrew_family_norm, specialty_name_he";
  // Separate reads, not one read of the family and a filter: a few families
  // hold hundreds of licences, and a capped read of one could drop the exact
  // name. The family read is only a weaker lead, so a handful is enough. There
  // is no name index (the 21 Oct lint migration dropped it as unused); each
  // read is a scan of 57k rows, about 9 ms in production for the biggest
  // family, which is fine for an admin pressing a button.
  const [exact, swapped, others] = await Promise.all([
    service.from("moh_practitioners").select(columns).eq("hebrew_family_norm", family).eq("hebrew_first_norm", first).limit(20),
    // A doctor who typed the family name where the first goes. A name that
    // reads the same both ways has no swapped reading.
    first === family
      ? Promise.resolve({ data: [] as Row[], error: null })
      : service.from("moh_practitioners").select(columns).eq("hebrew_family_norm", first).eq("hebrew_first_norm", family).limit(20),
    service
      .from("moh_practitioners")
      .select(columns)
      .eq("hebrew_family_norm", family)
      .neq("hebrew_first_norm", first)
      .order("license_number")
      .limit(FAMILY_LIMIT),
  ]);
  for (const r of [exact, swapped, others]) {
    if (r.error) throw new Error(`moh_practitioners read failed: ${r.error.message}`);
  }

  const picked = [
    ...((exact.data ?? []) as Row[]).map((r) => ({ r, kind: "exact" as const })),
    ...((swapped.data ?? []) as Row[]).map((r) => ({ r, kind: "swapped" as const })),
    ...((others.data ?? []) as Row[]).map((r) => ({ r, kind: "family" as const })),
  ];
  if (picked.length === 0) return [];

  const numbers = picked.map(({ r }) => String(r.license_number));
  const held = await service
    .from("doctor_license_slots")
    .select("license_number, doctor_id, doctor:doctors!inner(arabic_first_name, arabic_family_name)")
    .eq("license_region", "IL")
    .in("license_number", numbers)
    .neq("doctor_id", doctor.id);
  const holders = new Map<string, { id: string; name: string }>();
  for (const h of (held.data ?? []) as unknown as {
    license_number: string;
    doctor_id: string;
    doctor: { arabic_first_name: string; arabic_family_name: string } | { arabic_first_name: string; arabic_family_name: string }[] | null;
  }[]) {
    const d = Array.isArray(h.doctor) ? h.doctor[0] : h.doctor;
    holders.set(h.license_number, { id: h.doctor_id, name: d ? `${d.arabic_first_name} ${d.arabic_family_name}` : "" });
  }

  const digits = storedNumber.replace(/\D/g, "");
  return picked.map(({ r, kind }) => {
    const n = String(r.license_number);
    return {
      licenseNumber: n,
      firstName: r.hebrew_first_name,
      familyName: r.hebrew_family_name,
      specialtyHe: r.specialty_name_he?.trim() || null,
      kind,
      distance: digits ? levenshtein(digits, n) : null,
      heldBy: holders.get(n) ?? null,
    };
  });
}
