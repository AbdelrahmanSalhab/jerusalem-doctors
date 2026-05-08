// Server-side session helpers (plan §7 revised — dev-user shim).
//
// Primary path: read the Supabase Auth session from cookies and return the
// linked doctor row.
//
// Dev shim: when `USE_DEV_USER=1` is set (refused in production), return a
// hardcoded doctor row by id from `DEV_DOCTOR_ID`. The dev doctor must
// already exist in the DB — see `scripts/seed-dev-doctor.sql`.

import { redirect } from "next/navigation";
import type { Doctor } from "@/lib/db/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const isProd = () => process.env.NODE_ENV === "production";
const useDevUser = () =>
  process.env.USE_DEV_USER === "1" && !isProd();

if (process.env.USE_DEV_USER === "1" && isProd()) {
  // Surface the misconfiguration loudly at module load.
  throw new Error(
    "USE_DEV_USER=1 is forbidden in production. Unset before deploy.",
  );
}

/**
 * Returns the currently authenticated doctor, or null if no session.
 * Honours the dev-user shim when enabled.
 */
export async function getCurrentDoctor(): Promise<Doctor | null> {
  if (useDevUser()) {
    const id = process.env.DEV_DOCTOR_ID;
    if (!id) {
      throw new Error(
        "USE_DEV_USER=1 requires DEV_DOCTOR_ID. Run scripts/seed-dev-doctor.sql.",
      );
    }
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("doctors")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as Doctor | null) ?? null;
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("doctors")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as Doctor | null) ?? null;
}

/**
 * Same as getCurrentDoctor, but redirects unauthenticated visitors to /login.
 * Also redirects pending-approval doctors to a holding page (Phase 4).
 */
export async function requireDoctor(): Promise<Doctor> {
  const doctor = await getCurrentDoctor();
  if (!doctor) redirect("/login");
  if (!doctor.is_active) redirect("/login?status=inactive");
  return doctor;
}

/**
 * True when phone-OTP-based signup/login is intentionally disabled in this
 * environment (e.g. production while we're still building). Surface a banner
 * in /signup and /login pages to set expectations.
 */
export function isPhoneAuthDisabled(): boolean {
  return process.env.NEXT_PUBLIC_PHONE_AUTH_DISABLED === "1";
}
