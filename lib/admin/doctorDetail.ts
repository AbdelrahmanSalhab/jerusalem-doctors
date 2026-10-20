// Everything an admin needs about one doctor, in one round of reads.
//
// Until now an admin deciding whether to let a doctor in saw less about them
// than any logged-in colleague does on their card: no photo, no email, no
// specialties, no workplaces. This assembles the whole picture, plus the two
// licence explanations, so the panel is a plain render of it.

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { explainLicense, type LicenseExplanation } from "@/lib/moh/explain";
import { readMirrorFreshness, readMirrorRows } from "@/lib/moh/mirror";
import { ilLicenseCandidates } from "@/lib/normalize/license";
import type { AuditRow } from "@/lib/auditText";

export interface DetailWorkplace {
  name: string;
  workplace_type: string;
  details: string | null;
  address: string | null;
  hours: string | null;
  phone: string | null;
  is_primary: boolean;
  sort_order: number;
}

export interface DetailDoctor {
  id: string;
  arabic_first_name: string;
  arabic_family_name: string;
  arabic_full_name: string;
  hebrew_first_name: string | null;
  hebrew_family_name: string | null;
  phone_e164: string;
  phone_display: string | null;
  email: string | null;
  bio: string | null;
  subspecialty: string | null;
  certificates: string[] | null;
  profile_picture_url: string | null;
  career_stage: "resident" | "specialist" | null;
  residency_start_year: number | null;
  license_number: string;
  license_region: "IL" | "PS";
  license_verification_status: string | null;
  license_verified_at: string | null;
  secondary_license_number: string | null;
  secondary_license_region: "IL" | "PS" | null;
  secondary_license_verification_status: string | null;
  is_admin_approved: boolean;
  is_active: boolean;
  is_visible: boolean;
  is_phone_verified: boolean;
  is_admin: boolean;
  consent_directory_use: boolean;
  consent_timestamp: string | null;
  seeking_work: boolean;
  featured: "doctor" | "graduate" | null;
  featured_at: string | null;
  created_at: string;
  updated_at: string;
  auth_user_id: string | null;
}

export interface LicenseSlotDetail {
  slot: "primary" | "secondary";
  label: string;
  region: "IL" | "PS";
  number: string;
  status: string | null;
  verifiedAt: string | null;
  explanation: LicenseExplanation;
}

export interface DoctorDetail {
  doctor: DetailDoctor;
  /** Names, for the read-only panel. */
  specialties: string[];
  /** Ids, for the editor's picker. Same read, no extra round trip. */
  specialtyIds: string[];
  workplaces: DetailWorkplace[];
  licenses: LicenseSlotDetail[];
  audit: (AuditRow & { id: string; created_at: string })[];
  lastSignInAt: string | null;
}

const DOCTOR_COLUMNS = `
  id, arabic_first_name, arabic_family_name, arabic_full_name,
  hebrew_first_name, hebrew_family_name,
  phone_e164, phone_display, email, bio, subspecialty, certificates,
  profile_picture_url, career_stage, residency_start_year,
  license_number, license_region, license_verification_status, license_verified_at,
  secondary_license_number, secondary_license_region, secondary_license_verification_status,
  is_admin_approved, is_active, is_visible, is_phone_verified, is_admin,
  consent_directory_use, consent_timestamp, seeking_work, featured, featured_at,
  created_at, updated_at, auth_user_id
`;

/** Every reading of a licence number, so the mirror read covers the one that
 *  won at signup as well as the one the admin may have meant. */
function serialsOf(region: string | null, number: string | null): string[] {
  if (!number || region !== "IL") return [];
  return ilLicenseCandidates(number) ?? [number];
}

export async function fetchDoctorDetail(
  service: SupabaseClient,
  id: string,
): Promise<DoctorDetail | null> {
  // A malformed id would fail the read with 22P02; it is simply not found.
  if (!z.guid().safeParse(id).success) return null;
  const { data, error } = await service.from("doctors").select(DOCTOR_COLUMNS).eq("id", id).maybeSingle();
  if (error && error.code !== "PGRST116") throw new Error(`doctor read failed: ${error.message}`);
  if (!data) return null;
  const doctor = data as unknown as DetailDoctor;

  const serials = [
    ...serialsOf(doctor.license_region, doctor.license_number),
    ...serialsOf(doctor.secondary_license_region, doctor.secondary_license_number),
  ];

  const [specialtyRows, workplaceRows, mirror, syncedAt, auditRows, lastSignInAt] = await Promise.all([
    service.from("doctor_specialties").select("specialty_id, specialty:specialties(name_ar)").eq("doctor_id", id),
    service
      .from("doctor_workplaces")
      .select("name, workplace_type, details, address, hours, phone, is_primary, sort_order")
      .eq("doctor_id", id)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true }),
    readMirrorRows(service, serials),
    readMirrorFreshness(service),
    service
      .from("audit_logs")
      .select("id, action, metadata, created_at")
      .eq("target_doctor_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    readLastSignIn(service, doctor.auth_user_id),
  ]);

  const hasSecondaryIl = doctor.secondary_license_region === "IL";

  const licenses: LicenseSlotDetail[] = [
    {
      slot: "primary",
      label: "الترخيص الأساسي",
      region: doctor.license_region,
      number: doctor.license_number,
      status: doctor.license_verification_status,
      verifiedAt: doctor.license_verified_at,
      explanation: explainLicense({
        status: doctor.license_verification_status,
        region: doctor.license_region,
        licenseNumber: doctor.license_number,
        hebrewFirstName: doctor.hebrew_first_name,
        hebrewFamilyName: doctor.hebrew_family_name,
        registryRow: mirror.get(doctor.license_number) ?? null,
        mirrorSyncedAt: syncedAt,
        licenseVerifiedAt: doctor.license_verified_at,
        hasSecondaryIl,
      }),
    },
  ];

  if (doctor.secondary_license_number && doctor.secondary_license_region) {
    licenses.push({
      slot: "secondary",
      label: "ترخيص إضافي",
      region: doctor.secondary_license_region,
      number: doctor.secondary_license_number,
      status: doctor.secondary_license_verification_status,
      // There is no secondary_license_verified_at column.
      verifiedAt: null,
      explanation: explainLicense({
        status: doctor.secondary_license_verification_status,
        region: doctor.secondary_license_region,
        licenseNumber: doctor.secondary_license_number,
        hebrewFirstName: doctor.hebrew_first_name,
        hebrewFamilyName: doctor.hebrew_family_name,
        registryRow: mirror.get(doctor.secondary_license_number) ?? null,
        mirrorSyncedAt: syncedAt,
        licenseVerifiedAt: null,
      }),
    });
  }

  return {
    doctor,
    specialties: specialtyNames(specialtyRows.data),
    specialtyIds: ((specialtyRows.data ?? []) as { specialty_id: string }[]).map((r) => r.specialty_id),
    workplaces: (workplaceRows.data ?? []) as unknown as DetailWorkplace[],
    licenses,
    audit: (auditRows.data ?? []) as unknown as DoctorDetail["audit"],
    lastSignInAt,
  };
}

/** PostgREST returns an embedded relation as an object or an array. */
function specialtyNames(data: unknown): string[] {
  const rows = (data ?? []) as { specialty: { name_ar: string } | { name_ar: string }[] | null }[];
  return rows
    .flatMap((r) => (Array.isArray(r.specialty) ? r.specialty : r.specialty ? [r.specialty] : []))
    .map((s) => s.name_ar)
    .filter(Boolean);
}

/** There is no doctors.last_login_at; the sign-in time lives on the auth user.
 *  Never worth failing the panel over. */
async function readLastSignIn(service: SupabaseClient, authUserId: string | null): Promise<string | null> {
  if (!authUserId) return null;
  try {
    const { data } = await service.auth.admin.getUserById(authUserId);
    return data?.user?.last_sign_in_at ?? null;
  } catch {
    return null;
  }
}
