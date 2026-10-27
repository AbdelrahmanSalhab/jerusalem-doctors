// POST /api/sms/delivery?k=…: SMS4FREE reports whether a code text reached
// the phone (lib/otp/delivery.ts). Counted as a usage event against the
// doctor or the signup the number belongs to; the number itself isn't kept.

import { DELIVERY_STATUS, deliveryDelaySeconds, validDeliveryKey } from "@/lib/otp/delivery";
import { InvalidPhoneError, normalizePhone } from "@/lib/normalize/phone";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordEvent } from "@/lib/usage";

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
  const delay = deliveryDelaySeconds(String(form.get("msgId") ?? ""));

  const service = createSupabaseServiceClient();
  // Whose text: a doctor's (sign-in), else the newest signup on the number.
  const [doctor, signup] = phone
    ? await Promise.all([
        service.from("doctors").select("id").eq("phone_e164", phone).maybeSingle(),
        service
          .from("pending_signups")
          .select("id")
          .eq("phone_e164", phone)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
    : [null, null];
  await recordEvent(service, kind, {
    doctorId: doctor?.data?.id,
    meta: {
      ...(delay !== null && { delay_s: delay }),
      ...(!doctor?.data && signup?.data && { signup: signup.data.id }),
    },
  });
  return empty(200);
}
