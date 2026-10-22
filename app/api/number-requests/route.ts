// POST /api/number-requests
// A search found nobody: the doctor asks the admins for that colleague's
// number. The request waits on /admin/requests until an admin sends the
// number over WhatsApp and closes it.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({ q: z.string().trim().min(1).max(100) });

export const POST = withJsonErrors(async (req: Request) => {
  const me = await requireDoctor().catch(() => null);
  if (!me) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const rl = await rateLimit("numberRequest", `doctor:${me.id}`);
  if (!rl.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  const r = await createSupabaseServiceClient()
    .from("number_requests")
    .insert({ requester_id: me.id, query: parsed.data.q });
  if (r.error) {
    console.error("[number-requests] insert failed", r.error);
    return jsonError(500, { error: "insert_failed", code: "insert_failed" });
  }

  return jsonOk({ ok: true });
});
