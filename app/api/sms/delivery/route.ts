// POST /api/sms/delivery?k=…: SMS4FREE reports whether a code text reached
// the phone (lib/otp/delivery.ts). Counted as a usage event against the
// doctor or the signup the number belongs to; the number itself isn't kept.

import { DELIVERY_STATUS, deliveryDelaySeconds, validDeliveryKey } from "@/lib/otp/delivery";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { textOwner } from "@/lib/otp/owner";
import { claimOnce } from "@/lib/otp/sentOnce";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordEvent } from "@/lib/usage";

/** Reports come minutes to hours after the send; a day covers any retry. */
const REPORT_TTL_SECONDS = 86_400;

const empty = (status: number) => Response.json({}, { status });

export async function POST(req: Request) {
  if (!validDeliveryKey(new URL(req.url).searchParams.get("k"), process.env.SEND_SMS_HOOK_SECRET)) {
    return empty(401);
  }
  const form = await req.formData().catch(() => null);
  const kind = DELIVERY_STATUS[String(form?.get("status") ?? "") as keyof typeof DELIVERY_STATUS];
  // Another status is not one we count; answered so SMS4FREE stops asking.
  if (!form || !kind) return empty(200);

  let phone: string | null = null;
  try {
    phone = normalizePhone(String(form.get("to") ?? ""));
  } catch (e) {
    if (!(e instanceof InvalidPhoneError)) throw e;
  }
  // SMS4FREE may report a text more than once: count each (message, status) once.
  const msgId = String(form.get("msgId") ?? "");
  if (msgId && !(await claimOnce(`sms-report:${msgId}:${kind}`, REPORT_TTL_SECONDS))) return empty(200);
  const delay = deliveryDelaySeconds(msgId);

  const service = createSupabaseServiceClient();
  // Whose text: a doctor's (sign-in), else the newest signup on the number.
  const owner = phone ? await textOwner(service, phone) : {};
  await recordEvent(service, kind, {
    doctorId: owner.doctorId,
    meta: {
      ...(delay !== null && { delay_s: delay }),
      ...(owner.signupId && { signup: owner.signupId }),
    },
  });
  return empty(200);
}
