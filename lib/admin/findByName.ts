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
/** Exact and swapped readings are a handful at most; one more tells us there are more. */
const NAME_LIMIT = 20;
/** The biggest family in the registry holds a few hundred licences. */
const FAMILY_READ = 1000;

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
  /** This doctor already has it: the slot being edited, or their other licence. */
  own: "stored" | "other_slot" | null;
}

export interface NameLookup {
  candidates: NameCandidate[];
  /** The list was cut: more people in the registry fit than are shown. */
  more: boolean;
}

interface Row {
  license_number: number;
  hebrew_first_name: string;
  hebrew_family_name: string;
  hebrew_first_norm: string;
  hebrew_family_norm: string;
  specialty_name_he: string | null;
}

/** The normalizer keeps a hyphen and a space apart, so "A-B" and "A B" would
 *  never be equal; the registry writes a double-barrelled name either way. */
const spellings = (name: string) => [...new Set([name, name.replace(/-/g, " "), name.replace(/ /g, "-")])];

const byNumber = (a: Row, b: Row) => a.license_number - b.license_number;

export async function findByName(
  service: SupabaseClient,
  doctor: { id: string; hebrew_first_name: string | null; hebrew_family_name: string | null },
  storedNumber: string,
): Promise<NameLookup> {
  const first = normalizeHebrew(doctor.hebrew_first_name ?? "");
  const family = normalizeHebrew(doctor.hebrew_family_name ?? "");
  if (!first || !family) return { candidates: [], more: false };

  const columns =
    "license_number, hebrew_first_name, hebrew_family_name, hebrew_first_norm, hebrew_family_norm, specialty_name_he";
  const firsts = spellings(first);
  const families = spellings(family);
  const read = (familyNames: string[], firstNames?: string[]) => {
    const q = service.from("moh_practitioners").select(columns).in("hebrew_family_norm", familyNames);
    return (firstNames ? q.in("hebrew_first_norm", firstNames) : q).order("license_number");
  };
  // Separate reads, not one read of the family and a filter: a few families
  // hold hundreds of licences, and a capped read of one could drop the exact
  // name. There is no name index (the 21 Oct lint migration dropped it as
  // unused), so each read scans the 57k rows: about 9 ms on production whether
  // the family is the biggest (388 licences), a rare one, or absent.
  const [exact, swapped, others] = await Promise.all([
    read(families, firsts).limit(NAME_LIMIT + 1),
    // A doctor who typed the family name where the first goes. A name that
    // reads the same both ways has no swapped reading.
    first === family
      ? Promise.resolve({ data: [] as Row[], error: null })
      : read(firsts, families).limit(NAME_LIMIT + 1),
    // Every other first name in the family, ranked here by how close the first
    // name is: ordering by number alone would cut the near-exact spelling.
    read(families).limit(FAMILY_READ),
  ]);
  for (const r of [exact, swapped, others]) {
    if (r.error) throw new Error(`moh_practitioners read failed: ${r.error.message}`);
  }

  const digits = storedNumber.replace(/\D/g, "");
  const gap = (r: Row) => (digits ? levenshtein(digits, String(r.license_number)) : Infinity);
  const nearest = (a: Row, b: Row) => gap(a) - gap(b) || byNumber(a, b);

  const exactRows = ((exact.data ?? []) as Row[]).sort(nearest);
  const swappedRows = ((swapped.data ?? []) as Row[]).sort(nearest);
  const familyRows = ((others.data ?? []) as Row[])
    .filter((r) => !firsts.includes(r.hebrew_first_norm))
    .sort((a, b) => levenshtein(first, a.hebrew_first_norm) - levenshtein(first, b.hebrew_first_norm) || nearest(a, b));
  const more =
    exactRows.length > NAME_LIMIT ||
    swappedRows.length > NAME_LIMIT ||
    familyRows.length > FAMILY_LIMIT ||
    (others.data ?? []).length >= FAMILY_READ;

  const picked = [
    ...exactRows.slice(0, NAME_LIMIT).map((r) => ({ r, kind: "exact" as const })),
    ...swappedRows.slice(0, NAME_LIMIT).map((r) => ({ r, kind: "swapped" as const })),
    ...familyRows.slice(0, FAMILY_LIMIT).map((r) => ({ r, kind: "family" as const })),
  ];
  if (picked.length === 0) return { candidates: [], more };

  const numbers = picked.map(({ r }) => String(r.license_number));
  const held = await service
    .from("doctor_license_slots")
    .select("license_number, doctor_id, doctor:doctors!inner(arabic_first_name, arabic_family_name)")
    .eq("license_region", "IL")
    .in("license_number", numbers);
  // Unlike the registry, a failed read here must not read as "nobody holds it".
  if (held.error) throw new Error(`doctor_license_slots read failed: ${held.error.message}`);
  const holders = new Map<string, { id: string; name: string }>();
  for (const h of (held.data ?? []) as unknown as {
    license_number: string;
    doctor_id: string;
    doctor: { arabic_first_name: string; arabic_family_name: string } | { arabic_first_name: string; arabic_family_name: string }[] | null;
  }[]) {
    const d = Array.isArray(h.doctor) ? h.doctor[0] : h.doctor;
    holders.set(h.license_number, { id: h.doctor_id, name: d ? `${d.arabic_first_name} ${d.arabic_family_name}` : "" });
  }

  const candidates = picked.map(({ r, kind }): NameCandidate => {
    const n = String(r.license_number);
    const holder = holders.get(n) ?? null;
    const mine = holder?.id === doctor.id;
    return {
      licenseNumber: n,
      firstName: r.hebrew_first_name,
      familyName: r.hebrew_family_name,
      specialtyHe: r.specialty_name_he?.trim() || null,
      kind,
      distance: digits ? levenshtein(digits, n) : null,
      heldBy: holder && !mine ? holder : null,
      own: digits === n ? "stored" : mine ? "other_slot" : null,
    };
  });
  return { candidates, more };
}
