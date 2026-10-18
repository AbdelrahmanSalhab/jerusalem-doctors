// What the directory shows of a doctor, and who it shows. Shared by
// /api/search and the dashboard's featured sections so a card never differs
// depending on where it was loaded from.

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
}

export interface SearchHit {
  id: string;
  arabic_first_name: string;
  arabic_family_name: string;
  hebrew_first_name: string | null;
  hebrew_family_name: string | null;
  license_number: string;
  /** Null only when the column itself is unset; the directory always shows it. */
  phone_display: string | null;
  /** Drives the WhatsApp button on the card. */
  whatsapp_url: string | null;
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
  doctor: "طبيب مميز",
  graduate: "خريج جديد مميز",
};

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
      license_number,
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
      doctor_specialties(
        specialty:specialties(id, name_ar)
      ),
      doctor_workplaces(name, workplace_type, details, address, hours, phone, is_primary, sort_order)
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
  license_number: string;
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
    }));

  return {
    id: d.id,
    arabic_first_name: d.arabic_first_name,
    arabic_family_name: d.arabic_family_name,
    hebrew_first_name: d.hebrew_first_name,
    hebrew_family_name: d.hebrew_family_name,
    license_number: d.license_number,
    phone_display: d.phone_display,
    // buildWhatsAppLink throws on an empty string; one malformed row must
    // not fail the whole response.
    whatsapp_url: d.phone_e164 ? buildWhatsAppLink(d.phone_e164) : null,
    email: d.email,
    subspecialty: d.subspecialty,
    bio: d.bio,
    career_stage: d.career_stage,
    residency_start_year: d.residency_start_year,
    specialties,
    certificates: d.certificates ?? [],
    seeking_work: d.seeking_work ?? false,
    workplaces,
    profile_picture_url: d.profile_picture_url ?? null,
  };
}

/** What a card shows as its chips: a طب عام doctor's certificates replace
 *  the الطب العام chip they all share. */
export function cardChips(d: Pick<SearchHit, "career_stage" | "specialties" | "certificates">) {
  return d.career_stage === null && d.certificates.length > 0
    ? d.certificates
    : d.specialties;
}

export const SEEKING_WORK_LABEL = "يبحث عن فرصة عمل";

export interface FeaturedDoctors {
  doctor: SearchHit | null;
  /** Featured graduates who still have seeking_work on. */
  graduates: SearchHit[];
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
