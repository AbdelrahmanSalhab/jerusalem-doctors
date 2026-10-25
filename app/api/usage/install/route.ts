// POST /api/usage/install: a step of adding the directory to the home
// screen (#150, components/install). Sent with navigator.sendBeacon, so it
// never delays the step itself. Only the kind, the doctor and the browser
// family are kept.

import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { INSTALL_GUIDES } from "@/lib/install/context";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { INSTALL_KINDS, recordEvent } from "@/lib/usage";

const Body = z.object({
  kind: z.enum(INSTALL_KINDS),
  guide: z.enum(INSTALL_GUIDES),
  source: z.enum(["card", "menu"]).optional(),
});

export const POST = withJsonErrors(async (req: Request) => {
  const me = await requireDoctor().catch(() => null);
  if (!me) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  // sendBeacon posts text/plain; parse the body ourselves.
  const parsed = Body.safeParse(await req.text().then((t) => JSON.parse(t)).catch(() => null));
  if (!parsed.success) return jsonError(400, { error: "invalid_body", code: "invalid_body" });

  const rl = await rateLimit("installEvent", `doctor:${me.id}`);
  if (rl.success) {
    const { kind, guide, source } = parsed.data;
    await recordEvent(createSupabaseServiceClient(), kind, {
      doctorId: me.id,
      meta: source ? { guide, source } : { guide },
    });
  }
  return new NextResponse(null, { status: 204 });
});
