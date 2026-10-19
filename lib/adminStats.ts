// The numbers behind /admin/stats, from one admin_stats() call (0015).

import type { SupabaseClient } from "@supabase/supabase-js";

type Count = number;
export interface NamedCount {
  name: string;
  count: Count;
}

export interface AdminStats {
  generated_at: string;
  doctors: {
    total: Count; listed: Count; pending: Count; suspended: Count;
    new_24h: Count; new_7d: Count; new_30d: Count; seeking_work: Count;
    with_photo: Count; with_bio: Count; with_workplace: Count;
    approved_auto: Count; approved_manual: Count;
  };
  stage: { general: Count; resident: Count; specialist: Count };
  license: {
    il_only: Count; ps_only: Count; both: Count;
    verified: Count; soft_match: Count; not_found: Count; mismatch_overridden: Count;
  };
  activity: { active_7d: Count; active_30d: Count; never: Count };
  daily: { day: string; signups: Count; searchers: Count; contacts: Count }[];
  /** Call, WhatsApp and add-to-contacts presses, last 7 days (0017). */
  contacts: {
    whatsapp_7d: Count; call_7d: Count; save_7d: Count;
    contacters_7d: Count; contacted_7d: Count;
  };
  /** Accounts that reached 20+ different doctors in 24 h. */
  heavy_contacters: NamedCount[];
  domains: NamedCount[];
  workplace_types: { hospital: Count; clinic: Count; hmo: Count };
  /** Doctors per institution (0016), most first. */
  institutions: (NamedCount & { kind: "hospital" | "hmo" | "clinic_network" })[];
  attention: {
    pending: Count; pending_oldest: string | null; pending_not_found: Count;
    pending_mismatch: Count; deletion_requests: Count; deletion_oldest: string | null;
    clinics: Count; clinics_missing_details: Count; never_logged_in: Count;
    unmatched_workplaces: Count;
  };
  usage: {
    searchers_7d: Count; searches_7d: Count; filter_empty_7d: Count;
    signup_started_7d: Count; login_code_sent_7d: Count; login_succeeded_7d: Count;
    login_unregistered_7d: Count; login_send_failed_24h: Count; since: string | null;
  };
  signup_completed_7d: Count;
  empty_specialties: NamedCount[];
  moh_sync: { action: string; at: string } | null;
}

export async function fetchAdminStats(service: SupabaseClient): Promise<AdminStats> {
  const { data, error } = await service.rpc("admin_stats");
  if (error) throw error;
  return data as AdminStats;
}

/** "42%" of a whole; "0%" when there is no whole yet. */
export function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part * 100) / whole)}%` : "0%";
}

/** Whole days since an ISO time, for "the oldest has waited N days". */
export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}
