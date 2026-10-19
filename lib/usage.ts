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
  | "contact_save";

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
