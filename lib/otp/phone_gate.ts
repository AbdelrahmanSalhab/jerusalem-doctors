import { jsonError } from "@/lib/api/respond";
import {
  PhoneNotSmsDeliverableError,
  assertSmsDeliverable,
} from "@/lib/normalize/phone";
import type { NextResponse } from "next/server";

/**
 * Reject a number we cannot deliver an OTP to, before asking Supabase to
 * issue a code for it.
 *
 * Without this the doctor gets a "code sent" screen and then waits forever:
 * Supabase happily creates the code, the hook fires, and SMS4FREE rejects the
 * number. Failing here instead makes the reason visible on the phone field.
 *
 * This is about the number typed into the form, not about any account, so a
 * 400 here reveals nothing an attacker could use to enumerate members — which
 * is why /login/resend can call it despite answering 200 to everything else.
 */
export function rejectUndeliverablePhone(e164: string): NextResponse | null {
  try {
    assertSmsDeliverable(e164);
    return null;
  } catch (e) {
    if (!(e instanceof PhoneNotSmsDeliverableError)) throw e;
    const message =
      e.reason === "foreign_region"
        ? "الدخول متاح حاليًا للأرقام الإسرائيلية (+972) فقط."
        : "الرجاء إدخال رقم هاتف محمول، لا رقم أرضي.";
    return jsonError(400, {
      error: "phone_unsupported",
      code: "phone_unsupported",
      fields: { phone: message },
    });
  }
}
