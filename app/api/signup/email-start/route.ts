// POST /api/signup/email-start
// (Re-)sends the verification email to the authenticated doctor.
// Called automatically by signup/verify (initial send) and by the VerifyForm
// "resend" button (subsequent sends). Tokens always target the doctor row.
// Per-send unique Idempotency-Key (includes Date.now()) so each dispatch
// attempt produces a real send; safe to retry if the connection drops.
// Rate-limited to prevent use as a spam vector.

import { jsonError, jsonOk } from "@/lib/api/respond";
import { getCurrentDoctor } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { dispatchSignupVerifyEmail } from "@/lib/signup/email-dispatch";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// No body needed — the authenticated session identifies the doctor.

export async function POST() {
  // Rate limit per doctor (not per IP) to prevent one doctor from sending
  // spam to their own email address and to avoid shared-IP false positives.
  const me = await getCurrentDoctor().catch(() => null);
  if (!me) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const rl = await rateLimit("signupEmailStart", `doctor:${me.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  if (!me.email) return jsonError(400, { error: "no_email_on_file", code: "no_email_on_file" });

  const service = createSupabaseServiceClient();
  try {
    await dispatchSignupVerifyEmail({
      doctorId: me.id,
      email: me.email,
      // Guard against empty string from DB text column: fall back to generic
      // Arabic salutation so the email copy does not read "مرحبًا د. ،".
      arabicFirstName: me.arabic_first_name || "الطبيب",
    });
    await service
      .from("doctors")
      .update({ email_verification_sent_at: new Date().toISOString() })
      .eq("id", me.id);
  } catch (err) {
    console.error("[email-start] dispatch failed", err);
    return jsonError(502, { error: "email_send_failed", code: "email_send_failed" });
  }
  return jsonOk({ ok: true, sent: true });
}
