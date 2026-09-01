// Hand-written shadow of supabase/migrations/0001_init.sql.
//
// Replace this file with the output of:
//   npx supabase gen types typescript --linked > lib/db/types.ts
// once the Supabase CLI is linked to the project. Until then, this file
// keeps type imports in app code working.

export interface Doctor {
  id: string;
  auth_user_id: string | null;
  phone_e164: string;
  phone_display: string | null;
  arabic_first_name: string;
  arabic_family_name: string;
  arabic_full_name: string;
  arabic_first_name_normalized: string;
  arabic_family_name_normalized: string;
  arabic_full_name_normalized: string;
  hebrew_first_name: string | null;
  hebrew_family_name: string | null;
  hebrew_full_name: string | null;
  license_number: string;
  license_region: "IL" | "PS";
  license_verified_at: string | null;
  license_verification_status:
    | "verified"
    | "soft_match"
    | "not_found"
    | "name_mismatch_overridden"
    | null;
  secondary_license_region: "IL" | "PS" | null;
  secondary_license_number: string | null;
  secondary_license_verification_status:
    | "verified"
    | "soft_match"
    | "not_found"
    | "name_mismatch_overridden"
    | null;
  career_stage: "resident" | "specialist" | null;
  subspecialty: string | null;
  subspecialty_normalized: string | null;
  email: string | null;
  bio: string | null;
  consent_directory_use: boolean;
  consent_timestamp: string;
  is_phone_verified: boolean;
  is_active: boolean;
  is_visible: boolean;
  is_admin_approved: boolean;
  is_admin: boolean;
  phone_is_visible: boolean;
  workplaces_is_visible: boolean;
  profile_picture_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Specialty {
  id: string;
  name_ar: string;
  name_ar_normalized: string;
  name_he: string | null;
  name_en: string | null;
  sort_order: number | null;
  is_active: boolean;
}

export interface DoctorSpecialty {
  doctor_id: string;
  specialty_id: string;
}

export interface AuditLog {
  id: string;
  actor_doctor_id: string | null;
  action: string;
  target_doctor_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PendingSignup {
  id: string;
  phone_e164: string;
  payload: Record<string, unknown>;
  expires_at: string;
  attempts: number;
  created_at: string;
}

export interface DoctorWorkplace {
  id: string;
  doctor_id: string;
  name: string;
  name_normalized: string;
  workplace_type: "hospital" | "clinic";
  details: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MohPractitioner {
  license_number: number;
  hebrew_first_name: string;
  hebrew_family_name: string;
  hebrew_first_norm: string;
  hebrew_family_norm: string;
  specialty_name_he: string | null;
  license_issued_yyyymmdd: number | null;
  synced_at: string;
}
