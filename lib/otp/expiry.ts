// How long a code works once Supabase issues it: "SMS OTP Expiry" under
// Authentication → Sign In / Providers → Phone. Production is 10 minutes, the most NIST SP
// 800-63B-4 allows for a code sent out of band; the dashboard locks that field
// while the Send SMS hook is on, so it was set through the Management API
// (docs/runbook.md). The verify page tells the doctor this, so change both
// together.
export const OTP_VALID_SECONDS = 600;

/** "SMS OTP Length" in the same place: digits in a code. */
export const OTP_LENGTH = 6;

/** How soon after a send the verify page offers a new one. Its own number,
 *  not the code's lifetime: with a longer lifetime a late text must not make
 *  the doctor wait that long to ask again. Supabase's own floor between two
 *  sends to a number is 60 s. */
export const RESEND_AFTER_SECONDS = 60;

/** "دقيقة واحدة", "دقيقتين", "10 دقائق": for the verify page's sentences. */
export function validityText(seconds: number = OTP_VALID_SECONDS): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes === 1) return "دقيقة واحدة";
  if (minutes === 2) return "دقيقتين";
  return minutes <= 10 ? `${minutes} دقائق` : `${minutes} دقيقة`;
}
