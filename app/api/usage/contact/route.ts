// POST /api/usage/contact: a doctor pressed call, WhatsApp or "add to
// contacts" on a colleague's card. Sent with navigator.sendBeacon, so it
// never delays opening WhatsApp or the dialer. Only the viewer and the
// colleague's id are kept (0017).

import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordEvent } from "@/lib/usage";

const Body = z.object({
  target: z.uuid(),
  channel: z.enum(["call", "whatsapp", "save"]),
});

export const POST = withJsonErrors(async (req: Request) => {
  const me = await requireDoctor().catch(() => null);
  if (!me) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  // sendBeacon posts text/plain; parse the body ourselves.
  const parsed = Body.safeParse(await req.text().then((t) => JSON.parse(t)).catch(() => null));
  if (!parsed.success) return jsonError(400, { error: "invalid_body", code: "invalid_body" });

  // Recording past this many a minute adds nothing (and would let one
  // account flood the table); the press itself still works.
  const rl = await rateLimit("contactClick", `doctor:${me.id}`);
  if (rl.success) {
    await recordEvent(createSupabaseServiceClient(), `contact_${parsed.data.channel}`, {
      doctorId: me.id,
      meta: { target: parsed.data.target },
    });
  }
  return new NextResponse(null, { status: 204 });
});
