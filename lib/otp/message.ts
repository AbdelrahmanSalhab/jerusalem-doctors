// The OTP message body, in one place.
//
// Cost note: Arabic text forces UCS-2 encoding at the carrier, so a segment is
// 70 characters — not the 160 of GSM-7 Latin text. The template below renders
// to roughly 45 characters, i.e. exactly one billable segment per login. An
// innocuous-looking edit that pushes it past 70 doubles the per-message cost
// of every signup and login, permanently and silently. MAX_SEGMENT_CHARS and
// its test exist to make that mistake fail in CI instead of on the invoice.

/** Characters per SMS segment when the body contains non-Latin script. */
export const MAX_SEGMENT_CHARS = 70;

/**
 * Build the Arabic OTP body. The code is interpolated as-is — it arrives from
 * Supabase as a string and may carry a meaningful leading zero.
 */
export function buildOtpMessage(code: string): string {
  return `رمز دخول دليل أطباء القدس: ${code}. لا تشاركه.`;
}
