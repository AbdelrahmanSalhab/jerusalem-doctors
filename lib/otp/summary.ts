// What happened at the code step for one signup, for /admin/signups: counted
// from usage events (20261027113048_otp_events), so whoever follows up knows
// whether the code arrived, and whether it was typed and refused.

export interface CodeCounts {
  refused: number;
  locked: number;
  resent: number;
  delivered: number;
  undelivered: number;
  voice: number;
}

export const NO_CODES: CodeCounts = { refused: 0, locked: 0, resent: 0, delivered: 0, undelivered: 0, voice: 0 };

const KIND_TO_FIELD: Record<string, keyof CodeCounts> = {
  otp_refused: "refused",
  otp_locked: "locked",
  otp_resent: "resent",
  sms_delivered: "delivered",
  sms_undelivered: "undelivered",
  sms_voice: "voice",
};

/** Counts per signup id from usage events carrying meta.signup. */
export function countBySignup(events: { kind: string; meta: unknown }[]): Map<string, CodeCounts> {
  const out = new Map<string, CodeCounts>();
  for (const e of events) {
    const signup = (e.meta as { signup?: unknown } | null)?.signup;
    const field = KIND_TO_FIELD[e.kind];
    if (typeof signup !== "string" || !field) continue;
    const c = out.get(signup) ?? { ...NO_CODES };
    out.set(signup, { ...c, [field]: c[field] + 1 });
  }
  return out;
}

/** "وصلت الرسالة: 2 · رمز مرفوض: 3 · رمز جديد: 1", or "" when nothing is known. */
export function codeSummary(c: CodeCounts): string {
  return [
    c.delivered && `وصلت الرسالة: ${c.delivered}`,
    c.undelivered && `لم تصل: ${c.undelivered}`,
    c.voice && `مكالمة صوتية (رقم كوشير): ${c.voice}`,
    c.refused && `رمز مرفوض: ${c.refused}`,
    c.resent && `رمز جديد: ${c.resent}`,
    c.locked && "تجاوز عدد المحاولات",
  ]
    .filter(Boolean)
    .join(" · ");
}
