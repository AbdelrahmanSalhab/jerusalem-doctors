// Admin-managed allowlist for `not_found` license signups. See
// supabase/migrations/0007_pre_approved_licenses.sql.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function isPreApproved(
  service: SupabaseClient,
  licenseNumber: string,
): Promise<boolean> {
  const { data, error } = await service
    .from("pre_approved_licenses")
    .select("license_number")
    .eq("license_number", licenseNumber)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return Boolean(data);
}
