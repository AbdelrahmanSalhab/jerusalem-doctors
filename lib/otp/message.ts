// The OTP message body, in one place.
//
// Cost note: Arabic text forces UCS-2 encoding at the carrier, so a segment is
// 70 characters, not the 160 of GSM-7 Latin text. The template below renders
// to roughly 45 characters, i.e. exactly one billable segment per login. An
// innocuous-looking edit that pushes it past 70 doubles the per-message cost
// of every signup and login, permanently and silently. MAX_SEGMENT_CHARS and
// its test exist to make that mistake fail in CI instead of on the invoice.

/** Characters per SMS segment when the body contains non-Latin script. */
export const MAX_SEGMENT_CHARS = 70;

/**
 * Build the Arabic OTP body. The code is interpolated as-is, it arrives from
 * Supabase as a string and may carry a meaningful leading zero.
 *
 * The code comes first: phones offer "use this code" more reliably when it
 * leads, and a doctor glancing at the notification sees it at once.
 */
export function buildOtpMessage(code: string, originHost?: string): string {
  // A domain-bound code (iOS 14+ AutoFill, Android Chrome's WebOTP): the last
  // line is "@host #code", so the browser offers the code only on this site
  // and a phishing page can't have it filled in. It must be the last line and
  // the host alone. Shorter wording keeps it in one segment (message.test.ts).
  if (originHost) return `${code} رمز دليل أطباء القدس\n@${originHost} #${code}`;
  return `${code} هو رمز دخول دليل أطباء القدس. لا تشاركه.`;
}

/**
 * The host for the domain-bound line, or undefined while it is off. Opt-in
 * (SMS_DOMAIN_LINE=1): a text carrying something that looks like an address
 * can be held back by carriers, so it is switched on once a real phone has
 * received it. Production's address comes from Vercel.
 */
export function originHostFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.SMS_DOMAIN_LINE !== "1") return undefined;
  return env.SMS_ORIGIN_HOST ?? env.VERCEL_PROJECT_PRODUCTION_URL;
}
