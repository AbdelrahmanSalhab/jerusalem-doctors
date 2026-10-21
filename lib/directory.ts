// What the directory shows of a doctor, and who it shows. Shared by
// /api/search (whose rows come from search_directory() in SQL) and the
// dashboard's featured sections, so a card never differs depending on where
// it was loaded from.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import type { WorkplaceType } from "@/lib/workplace";

export interface SearchWorkplace {
  name: string;
  workplace_type: WorkplaceType;
  /** Legacy free text; cards show it only when the clinic fields are empty. */
  details: string | null;
  address: string | null;
  hours: string | null;
  phone: string | null;
  is_primary: boolean;
  /** The hospital or fund it is linked to; absent from search results. */
  institution_id?: string | null;
}

export interface SearchHit {
  id: string;
  arabic_first_name: string;
  arabic_family_name: string;
  hebrew_first_name: string | null;
  hebrew_family_name: string | null;
  /** Null only when the column itself is unset; the directory always shows it. */
  phone_display: string | null;
  /** Drives the WhatsApp button on the card. No prefilled text: the card
   *  adds the viewer's own introduction (lib/contactIntro.ts). */
  whatsapp_url: string | null;
  /** For "add to contacts". */
  phone_e164: string | null;
  email: string | null;
  subspecialty: string | null;
  bio: string | null;
  career_stage: "resident" | "specialist" | null;
  /** Qualifies the resident badge: "طبيب مقيم · منذ ٢٠٢٢". */
  residency_start_year: number | null;
  specialties: string[];
  /** A طب عام doctor's extra certificates, shown in place of الطب العام. */
  certificates: string[];
  seeking_work: boolean;
  retired: boolean;
  /** Empty only for a doctor with no workplace rows. */
  workplaces: SearchWorkplace[];
  profile_picture_url: string | null;
}

/** Search returns at most this many doctors; the UI says so when more matched. */
export const SEARCH_PAGE_SIZE = 50;

export const FEATURED_GRADUATES_MAX = 6;

/** doctors.featured values (0013). */
export const FEATURED_KINDS = ["doctor", "graduate"] as const;
export type FeaturedKind = (typeof FEATURED_KINDS)[number];
export const FEATURED_LABEL: Record<FeaturedKind, string> = {
  doctor: "طبيب نفتخر به",
  graduate: "طبيب مميز يبحث عن عمل",
};

/** Listed doctors with what a card shows. Search builds the same card in SQL
 *  (search_directory(), migration 20261021084302); keep the two in step. */
export function directoryQuery(service: SupabaseClient) {
  return service
    .from("doctors")
    .select(
      `
      id,
      arabic_full_name,
      arabic_first_name,
      arabic_family_name,
      hebrew_first_name,
      hebrew_family_name,
      phone_display,
      phone_e164,
      profile_picture_url,
      email,
      subspecialty,
      bio,
      career_stage,
      residency_start_year,
      certificates,
      seeking_work,
      retired,
      doctor_specialties(
        specialty:specialties(id, name_ar)
      ),
      doctor_workplaces(name, workplace_type, details, address, hours, phone, is_primary, sort_order, institution_id)
    `,
    )
    .eq("is_active", true)
    .eq("is_visible", true)
    .eq("is_phone_verified", true)
    .eq("is_admin_approved", true)
    .eq("consent_directory_use", true);
}

interface DirectoryRow {
  id: string;
  arabic_first_name: string;
  arabic_family_name: string;
  hebrew_first_name: string | null;
  hebrew_family_name: string | null;
  phone_display: string | null;
  phone_e164: string | null;
  profile_picture_url: string | null;
  email: string | null;
  subspecialty: string | null;
  bio: string | null;
  career_stage: "resident" | "specialist" | null;
  residency_start_year: number | null;
  certificates: string[] | null;
  seeking_work: boolean | null;
  retired: boolean | null;
  doctor_specialties:
    | { specialty: { name_ar: string } | { name_ar: string }[] | null }[]
    | null;
  doctor_workplaces: (SearchWorkplace & { sort_order: number })[] | null;
}

export function toSearchHits(data: unknown): SearchHit[] {
  return ((data ?? []) as DirectoryRow[]).map(toSearchHit);
}

function toSearchHit(d: DirectoryRow): SearchHit {
  // PostgREST returns nested relations as arrays, even on FK joins.
  const specialties = (d.doctor_specialties ?? [])
    .flatMap((row) => {
      const s = row.specialty;
      if (!s) return [];
      return Array.isArray(s) ? s.map((x) => x.name_ar) : [s.name_ar];
    })
    .filter((n): n is string => Boolean(n));

  const workplaces = (d.doctor_workplaces ?? [])
    .slice()
    .sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return a.sort_order - b.sort_order;
    })
    .map((w): SearchWorkplace => ({
      name: w.name,
      workplace_type: w.workplace_type,
      details: w.details,
      address: w.address,
      hours: w.hours,
      phone: w.phone,
      is_primary: w.is_primary,
      ...(w.institution_id !== undefined && { institution_id: w.institution_id }),
    }));

  return {
    id: d.id,
    arabic_first_name: d.arabic_first_name,
    arabic_family_name: d.arabic_family_name,
    hebrew_first_name: d.hebrew_first_name,
    hebrew_family_name: d.hebrew_family_name,
    phone_display: d.phone_display,
    // buildWhatsAppLink throws on an empty string; one malformed row must
    // not fail the whole response.
    whatsapp_url: d.phone_e164 ? buildWhatsAppLink(d.phone_e164, "") : null,
    phone_e164: d.phone_e164,
    email: d.email,
    subspecialty: d.subspecialty,
    bio: d.bio,
    career_stage: d.career_stage,
    residency_start_year: d.residency_start_year,
    specialties,
    certificates: d.certificates ?? [],
    seeking_work: d.seeking_work ?? false,
    retired: d.retired ?? false,
    workplaces,
    profile_picture_url: d.profile_picture_url ?? null,
  };
}

/** Services and certificates a card lists on their own line; a طب عام
 *  doctor's appear as chips instead (cardChips). */
export function cardServices(d: Pick<SearchHit, "career_stage" | "certificates">): string[] {
  return d.career_stage === null ? [] : d.certificates;
}

/** What a card shows as its chips: a طب عام doctor's certificates replace
 *  the الطب العام chip they all share. */
export function cardChips(d: Pick<SearchHit, "career_stage" | "specialties" | "certificates">) {
  return d.career_stage === null && d.certificates.length > 0
    ? d.certificates
    : d.specialties;
}

export const SEEKING_WORK_LABEL = "يبحث عن فرصة عمل";
export const RETIRED_LABEL = "طبيب متقاعد";

export interface FeaturedDoctors {
  doctor: SearchHit | null;
  /** Featured graduates who still have seeking_work on. */
  graduates: SearchHit[];
}

export interface DirectoryCounts {
  /** Null when the count can't be read. */
  listed: number | null;
  /** Listed doctors per top-level specialty, subspecialties rolled up into
   *  their parent (a cardiologist counts under الباطنية, the chip the
   *  dashboard shows). Empty on a failed read: the chips then list every
   *  specialty, as they did before counts existed. */
  byDomain: Record<string, number>;
  /** Listed doctors per hospital or fund, by institution id. */
  byInstitution: Record<string, number>;
}

/** Counted in the database (directory_counts(), migration 20261021085031):
 *  one small value back, whatever the directory's size. */
export async function fetchDirectoryCounts(service: SupabaseClient): Promise<DirectoryCounts> {
  const { data, error } = await service.rpc("directory_counts");
  if (error || !data) return { listed: null, byDomain: {}, byInstitution: {} };
  const d = data as { listed: number; by_domain: Record<string, number>; by_institution?: Record<string, number> };
  // by_institution is absent until migration 20261021124944 is applied.
  return { listed: d.listed, byDomain: d.by_domain, byInstitution: d.by_institution ?? {} };
}

/** «جديد هذا الأسبوع» shows at most this many. */
export const RECENT_MAX = 6;
/** Read before ranking for the viewer, so a closer match further back can
 *  still make the cut. */
const RECENT_POOL = 24;

/** Listed doctors who joined in the last 7 days, newest first. Empty on a
 *  failed read: the section just does not show. */
export async function fetchRecent(service: SupabaseClient): Promise<SearchHit[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await directoryQuery(service)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(RECENT_POOL);
  if (error) console.error("[directory] recent read failed", error);
  return toSearchHits(data);
}

/** The viewer's own colleagues first: sharing a specialty area counts most,
 *  then a hospital or fund; ties stay newest first. The viewer is left out. */
export function rankRecent(
  recent: SearchHit[],
  me: { id: string; domains: ReadonlySet<string>; institutions: ReadonlySet<string> },
  domainOf: (specialtyName: string) => string | undefined,
): SearchHit[] {
  const score = (d: SearchHit) =>
    (d.specialties.some((s) => me.domains.has(domainOf(s) ?? "")) ? 2 : 0) +
    (d.workplaces.some((w) => w.institution_id && me.institutions.has(w.institution_id)) ? 1 : 0);
  return recent
    .filter((d) => d.id !== me.id)
    .map((d, i) => ({ d, i, s: score(d) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, RECENT_MAX)
    .map((x) => x.d);
}

/** A failed read hides the sections rather than failing the dashboard. */
export async function fetchFeatured(service: SupabaseClient): Promise<FeaturedDoctors> {
  const [doctor, graduates] = await Promise.all([
    directoryQuery(service)
      .eq("featured", "doctor")
      .order("featured_at", { ascending: false })
      .limit(1),
    directoryQuery(service)
      .eq("featured", "graduate")
      .eq("seeking_work", true)
      .order("featured_at", { ascending: false })
      .limit(FEATURED_GRADUATES_MAX),
  ]);
  if (doctor.error || graduates.error) {
    console.error("[directory] featured read failed", doctor.error ?? graduates.error);
  }
  return {
    doctor: toSearchHits(doctor.data)[0] ?? null,
    graduates: toSearchHits(graduates.data),
  };
}
