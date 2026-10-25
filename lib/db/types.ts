// Row types for app code, built on the generated database types
// (lib/db/database.types.ts: `npm run db:types`, and CI fails when it is
// stale). Text columns limited by a SQL check come out as plain `string`
// there; the few the app relies on as unions are narrowed here. Narrowing a
// name that is no longer a column fails the type check.

import type { CareerStage } from "@/lib/careerStage";
import type { Tables } from "@/lib/db/database.types";
import type { WorkplaceType } from "@/lib/workplace";

/** A row with some columns' types narrowed; every key must be a column. */
type Narrow<Row, N extends { [K in keyof N]: K extends keyof Row ? unknown : never }> = Omit<Row, keyof N> & N;

type LicenseStatus = "verified" | "soft_match" | "not_found" | "name_mismatch_overridden";

export type Doctor = Narrow<
  // Computed columns: only there when a select names them, never in "*".
  Omit<Tables<"doctors">, "clinic_missing_details" | "registry_specialty">,
  {
    license_region: "IL" | "PS";
    license_verification_status: LicenseStatus | null;
    secondary_license_region: "IL" | "PS" | null;
    secondary_license_verification_status: LicenseStatus | null;
    /** null is طب عام. */
    career_stage: CareerStage | null;
    /** Set by an admin; drives the dashboard's featured sections. */
    featured: "doctor" | "graduate" | null;
  }
>;

export type DoctorWorkplace = Narrow<Tables<"doctor_workplaces">, { workplace_type: WorkplaceType }>;
