// Server-side session helpers (plan §7 revised — dev-user shim).
//
// Primary path: read the Supabase Auth session from cookies and return the
// linked doctor row.
//
// Dev shim: when `USE_DEV_USER=1` is set (refused in production), return a
// hardcoded doctor row by id from `DEV_DOCTOR_ID`. The dev doctor must
// already exist in the DB — see `scripts/seed-dev-doctor.sql`.

import { redirect } from "next/navigation";
import { cache } from "react";
import type { Doctor } from "@/lib/db/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const isProd = () => process.env.NODE_ENV === "production";

// The dev shim only activates when BOTH env vars are set in a non-prod env.
// This makes toggling friction-free: comment one of them out and the shim
// disengages without errors.
const isDevUserEnabled = () =>
  process.env.USE_DEV_USER === "1" &&
  Boolean(process.env.DEV_DOCTOR_ID) &&
  !isProd();

// Log loudly if USE_DEV_USER is set in production. We don't *throw* here:
// Next's `next build` sets NODE_ENV=production but still loads .env.local,
// so a dev's local-only USE_DEV_USER=1 would block builds. The runtime
// check in isDevUserEnabled() is the actual safety guard — it disables the shim
// regardless of how USE_DEV_USER is set when NODE_ENV=production.
if (process.env.USE_DEV_USER === "1" && isProd()) {
  console.warn(
    "[auth/session] USE_DEV_USER=1 is set but NODE_ENV=production; " +
      "the dev shim will be ignored. Unset USE_DEV_USER before deploy.",
  );
}

/**
 * Returns the currently authenticated doctor, or null if no session.
 * Honours the dev-user shim when enabled.
 *
 * cache(): the header and the page both ask during one render; they share
 * one lookup instead of two sequential round trips each.
 */
export const getCurrentDoctor = cache(async (): Promise<Doctor | null> => {
  if (isDevUserEnabled()) {
    const id = process.env.DEV_DOCTOR_ID!; // checked in isDevUserEnabled()
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("doctors")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as Doctor | null) ?? null;
  }

  // getClaims verifies the JWT locally against the project's signing keys
  // (no Auth round trip); with a legacy symmetric secret it falls back to the
  // same server check getUser makes.
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (!userId) return null;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("doctors")
    .select("*")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Doctor | null) ?? null;
});

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
 * Like requireDoctor, but additionally requires `is_admin` (and an active
 * account: a deactivated admin is no admin). Used by the
 * admin panel layout. Returns 404 (notFound) for non-admins so the panel's
 * existence isn't leaked to regular users.
 */
export async function requireAdmin(): Promise<Doctor> {
  const doctor = await getCurrentDoctor();
  if (!doctor || !doctor.is_admin || !doctor.is_active) {
    const { notFound } = await import("next/navigation");
    notFound(); // throws — control never returns here
  }
  return doctor as Doctor;
}

/**
 * True when phone-OTP-based signup/login is intentionally disabled in this
 * environment (e.g. production while we're still building). Surface a banner
 * in /signup and /login pages to set expectations.
 */
export function isPhoneAuthDisabled(): boolean {
  return process.env.NEXT_PUBLIC_PHONE_AUTH_DISABLED === "1";
}
