// Counts for /admin/stats that nothing else records (migration 0015). An
// event is a kind, a time, the acting doctor when there is one, and a few
// non-identifying details: never a phone, a name or search text.
//
// Recording must never break or fail the request it describes, so errors
// are logged and dropped.

import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageKind =
  | "search"
  | "signup_started"
  | "login_code_sent"
  | "login_unregistered"
  | "login_send_failed"
  | "login_succeeded"
  | "contact_call"
  | "contact_whatsapp"
  | "contact_save"
  /** An SMS the provider accepted (the Send SMS hook): the real count, for
   *  metrics_daily, whatever flow asked for it. */
  | "sms_sent"
  /** A live data.gov.il request at signup, for a licence not in our copy. */
  | "registry_lookup"
  /** The code step (20261027113048_otp_events): a code refused, too many
   *  tries, a signup's new code, and SMS4FREE's delivery reports. */
  | "otp_refused"
  | "otp_locked"
  | "otp_resent"
  | "sms_delivered"
  | "sms_undelivered"
  | "sms_voice"
  /** A code that could not be sent (20261031100000_sms_failed): meta.reason
   *  says why; the doctor or signup it was for is kept, never the number. */
  | "sms_failed"
  /** Adding the directory to the home screen, step by step (#150, lib/install). */
  | InstallKind;

export const INSTALL_KINDS = [
  "install_invite_shown",
  "install_invite_snoozed",
  "install_click",
  "install_accepted",
  "install_completed",
  "install_app_opened",
] as const;
export type InstallKind = (typeof INSTALL_KINDS)[number];

export async function recordEvent(
  service: SupabaseClient,
  kind: UsageKind,
  details: { doctorId?: string; meta?: Record<string, string | number | boolean> } = {},
): Promise<void> {
  try {
    const { error } = await service.from("usage_events").insert({
      kind,
      doctor_id: details.doctorId ?? null,
      meta: details.meta ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error(`[usage] ${kind} not recorded`, err);
  }
}
