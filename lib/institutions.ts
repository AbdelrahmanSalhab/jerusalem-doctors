// Institutions: the hospitals, health funds and clinic networks doctors work
// at (migration 0016). A workplace keeps the doctor's own text ("كلاليت
// الشيخ جراح") for display and gets an institution_id behind it, so stats
// count "Clalit" once and search finds it however it was typed.
//
// Matching is by alias: a workplace belongs to an institution when its name
// contains one of the institution's names or spellings. Hospitals only match
// workplaces entered as hospitals (so "عيادة العيون" can't land on an eye
// hospital); health funds and clinic networks match any type, since doctors
// enter Clalit branches as clinics, funds and even hospitals. A name that
// matches two institutions (e.g. "لؤوميت و مكابي") stays unlinked and is
// reported for an admin to sort out, except that a hospital-type workplace
// naming one hospital and a fund goes to the hospital.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import type { WorkplaceType } from "@/lib/workplace";

export const INSTITUTION_KINDS = ["hospital", "hmo", "clinic_network"] as const;
export type InstitutionKind = (typeof INSTITUTION_KINDS)[number];

export const INSTITUTION_KIND_LABEL: Record<InstitutionKind, string> = {
  hospital: "مستشفى",
  hmo: "صندوق مرضى",
  clinic_network: "شبكة عيادات",
};

export interface Institution {
  id: string;
  name_ar: string;
  name_he: string | null;
  kind: InstitutionKind;
  aliases: string[];
}

/** Comparable form: Arabic and Hebrew normalized, punctuation as spaces. */
export function matchKey(s: string): string {
  return normalizeArabic(normalizeHebrew(s))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function keysOf(i: Institution): string[] {
  return [i.name_ar, i.name_he ?? "", ...i.aliases].map(matchKey).filter((k) => k.length >= 3);
}

/** The institution a workplace name belongs to, or null (none or ambiguous). */
export function matchInstitution(
  institutions: readonly Institution[],
  name: string,
  workplaceType: WorkplaceType,
): string | null {
  // A name that IS one of an institution's spellings links whatever type the
  // doctor picked: that is an admin's "ربط كطريقة كتابة", and "مقاصد" entered
  // as صندوق مرضى is still Al-Makassed. Only partial matches follow the type
  // rule below.
  const exact = matchKey(name);
  const exactHits = institutions.filter((i) => keysOf(i).includes(exact));
  if (exactHits.length === 1) return exactHits[0].id;

  const key = ` ${exact} `;
  const matched = institutions
    .filter((i) => i.kind !== "hospital" || workplaceType === "hospital")
    .map((i) => ({ i, all: keysOf(i), keys: keysOf(i).filter((k) => key.includes(k)) }))
    .filter((m) => m.keys.length > 0);
  // The most specific wins: plain "هداسا" (both campuses) gives way to
  // another match whose own names contain what it matched on ("هداسا جبل
  // المشارف" for "هداسا هار هتسوفيم"). Unrelated matches ("لؤوميت و مكابي")
  // both survive and stay ambiguous.
  const hits = matched
    .filter((m) => !matched.some((o) => o !== m && m.keys.every((k) => o.all.some((ok) => ok !== k && ok.includes(k)))))
    .map((m) => m.i);
  if (hits.length === 1) return hits[0].id;
  // A hospital-type workplace naming both its hospital and the fund that
  // runs it ("مسجات لداخ موحيدت") belongs to the hospital.
  const hospitals = hits.filter((i) => i.kind === "hospital");
  return workplaceType === "hospital" && hospitals.length === 1 ? hospitals[0].id : null;
}

/** Institutions whose names or spellings match a search term. */
export function institutionsMatching(institutions: readonly Institution[], term: string): string[] {
  const q = matchKey(term);
  if (q.length < 2) return [];
  return institutions.filter((i) => keysOf(i).some((k) => k.includes(q) || q.includes(k))).map((i) => i.id);
}

export async function fetchInstitutions(service: SupabaseClient): Promise<Institution[]> {
  const { data, error } = await service
    .from("institutions")
    .select("id, name_ar, name_he, kind, aliases")
    .order("name_ar");
  if (error) throw error;
  return (data ?? []) as Institution[];
}

interface WorkplaceRow {
  id: string;
  name: string;
  workplace_type: WorkplaceType;
  institution_id: string | null;
}

export interface RelinkResult {
  changed: number;
  /** Hospital and health-fund names no institution claims, most common first. */
  unmatched: { name: string; count: number }[];
}

const PAGE = 1000;

/**
 * Re-derive institution_id for workplaces (all, or one doctor's), writing
 * only the rows that change. Run after any edit to the list, after a profile
 * save or signup, and daily from the cron.
 */
export async function relinkWorkplaces(
  service: SupabaseClient,
  doctorId?: string,
): Promise<RelinkResult> {
  const institutions = await fetchInstitutions(service);
  const rows: WorkplaceRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = service
      .from("doctor_workplaces")
      .select("id, name, workplace_type, institution_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (doctorId) q = q.eq("doctor_id", doctorId);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...((data ?? []) as WorkplaceRow[]));
    if (!data || data.length < PAGE) break;
  }

  const moves = new Map<string | null, string[]>();
  const unmatched = new Map<string, number>();
  for (const w of rows) {
    const target = matchInstitution(institutions, w.name, w.workplace_type);
    if (target !== w.institution_id) {
      moves.set(target, [...(moves.get(target) ?? []), w.id]);
    }
    if (!target && w.workplace_type !== "clinic") {
      unmatched.set(w.name, (unmatched.get(w.name) ?? 0) + 1);
    }
  }

  let changed = 0;
  for (const [target, ids] of moves) {
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const { error } = await service
        .from("doctor_workplaces")
        .update({ institution_id: target })
        .in("id", chunk);
      if (error) throw error;
      changed += chunk.length;
    }
  }

  return {
    changed,
    unmatched: [...unmatched.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** Best effort after a save: a failure only delays the link to the cron. */
export async function relinkDoctor(service: SupabaseClient, doctorId: string): Promise<void> {
  try {
    await relinkWorkplaces(service, doctorId);
  } catch (err) {
    console.error("[institutions] relink after save failed", err);
  }
}

/**
 * Read-only view for the admin tab: doctors per institution, and hospital
 * and fund names no institution claims (with how many doctors use each).
 */
export async function institutionUsage(service: SupabaseClient): Promise<{
  /** Doctors per institution, by name, for "who works here". */
  doctors: Record<string, { id: string; name: string }[]>;
  unmatched: { name: string; count: number }[];
}> {
  const rows: { doctor_id: string; name: string; workplace_type: WorkplaceType; institution_id: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await service
      .from("doctor_workplaces")
      .select("doctor_id, name, workplace_type, institution_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < PAGE) break;
  }
  const perInstitution = new Map<string, Set<string>>();
  const unmatched = new Map<string, number>();
  for (const r of rows) {
    if (r.institution_id) {
      perInstitution.set(r.institution_id, (perInstitution.get(r.institution_id) ?? new Set()).add(r.doctor_id));
    } else if (r.workplace_type !== "clinic") {
      unmatched.set(r.name, (unmatched.get(r.name) ?? 0) + 1);
    }
  }
  const ids = [...new Set([...perInstitution.values()].flatMap((s) => [...s]))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await service
      .from("doctors")
      .select("id, arabic_first_name, arabic_family_name")
      .in("id", ids.slice(i, i + 150));
    if (error) throw error;
    for (const d of data ?? []) names.set(d.id, `${d.arabic_first_name} ${d.arabic_family_name}`);
  }
  return {
    doctors: Object.fromEntries(
      [...perInstitution].map(([inst, set]) => [
        inst,
        [...set]
          .map((id) => ({ id, name: names.get(id) ?? "?" }))
          .sort((a, b) => a.name.localeCompare(b.name, "ar")),
      ]),
    ),
    unmatched: [...unmatched.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
