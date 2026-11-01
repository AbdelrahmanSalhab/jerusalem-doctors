// A code that could not be sent, counted for /admin/stats: when, why, and
// for whom (a doctor or a signup, never the number). Logs and Sentry hold the
// same failures, but nobody can ask them "who was it, and how often".

import type { SupabaseClient } from "@supabase/supabase-js";
import { OtpProviderError } from "./provider";
import { textOwner } from "./owner";
import { claimOnce } from "./sentOnce";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordEvent } from "@/lib/usage";

/** A short label with no number, code or credential in it. */
export function failureReason(err: unknown): string {
  if (err instanceof OtpProviderError) return err.reason;
  const e = err as { code?: unknown; status?: unknown } | null;
  if (typeof e?.code === "string" && /^[a-z0-9_]{1,60}$/i.test(e.code)) return `supabase_${e.code}`;
  if (typeof e?.status === "number") return `supabase_http_${e.status}`;
  return "unknown";
}

/** Records the failure for whoever the number belongs to. Never throws. */
export async function recordSendFailure(
  service: SupabaseClient,
  reason: string,
  who: { phoneE164?: string; doctorId?: string; signupId?: string } = {},
): Promise<void> {
  try {
    const owner = who.phoneE164 ? await textOwner(service, who.phoneE164) : {};
    const doctorId = who.doctorId ?? owner.doctorId;
    const signup = who.signupId ?? (doctorId ? undefined : owner.signupId);
    await recordEvent(service, "sms_failed", {
      doctorId,
      meta: { reason, ...(signup && { signup }) },
    });
  } catch (err) {
    console.error("[otp] failure not recorded", err);
  }
}

/**
 * A request for a code that our own checks stopped before Supabase was asked:
 * its per-number or per-address limit, or a Turnstile check that failed. The
 * doctor saw an error, but a "no code" report needs these counted too. Not
 * tied to a doctor: the number is not looked up this early.
 */
export async function recordStopped(reason: "our_rate_limit" | "turnstile_failed"): Promise<void> {
  // At most one a minute per reason: these are the requests an attacker can
  // repeat for free, and each row is a write.
  if (!(await claimOnce(`otp-stopped:${reason}:${Math.floor(Date.now() / 60_000)}`, 120))) return;
  await recordSendFailure(createSupabaseServiceClient(), reason);
}
