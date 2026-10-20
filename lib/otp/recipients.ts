// Who may be sent a login code. Supabase Auth asks the SMS hook to deliver a
// code for whatever number reaches its OTP endpoint, and that endpoint only
// needs the anon key, which Supabase designs to be public. Our own routes
// gate the request (Turnstile, rate limits, an account or a signup in
// progress), but a direct call would skip them. The hook re-checks here, so
// only a registered doctor or a number with a live signup ever gets an SMS.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Throws when the database cannot answer; the hook then fails closed. */
export async function isKnownRecipient(service: SupabaseClient, e164: string): Promise<boolean> {
  const [doctor, pending] = await Promise.all([
    service.from("doctors").select("id").eq("phone_e164", e164).eq("is_active", true).limit(1).maybeSingle(),
    service
      .from("pending_signups")
      .select("id")
      .eq("phone_e164", e164)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle(),
  ]);
  if (doctor.error) throw doctor.error;
  if (pending.error) throw pending.error;
  return Boolean(doctor.data || pending.data);
}
