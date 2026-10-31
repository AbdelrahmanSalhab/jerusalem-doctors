// Whose text a phone number is: a doctor's (sign-in), else the newest signup
// on it. Used to count a delivery report or a failed send against the person
// without keeping the number (usage events never hold one).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface TextOwner {
  doctorId?: string;
  signupId?: string;
}

export async function textOwner(service: SupabaseClient, phoneE164: string): Promise<TextOwner> {
  const [doctor, signup] = await Promise.all([
    service.from("doctors").select("id").eq("phone_e164", phoneE164).maybeSingle(),
    service
      .from("pending_signups")
      .select("id")
      .eq("phone_e164", phoneE164)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (doctor.data) return { doctorId: doctor.data.id };
  return signup.data ? { signupId: signup.data.id } : {};
}
