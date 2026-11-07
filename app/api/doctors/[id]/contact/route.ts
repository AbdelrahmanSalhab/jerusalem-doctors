// POST /api/doctors/[id]/contact: a colleague's number, WhatsApp link and email,
// asked for by tapping the card (#16). Search and the dashboard no longer carry
// them. Each account may reveal a limited number of different doctors a day
// (lib/contactBudget.ts); going over is refused and tells the admins once.

import { z } from "zod";
import { raiseAlert } from "@/lib/alerts";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { refuseUnlessApproved } from "@/lib/auth/directoryAccess";
import { requireDoctor } from "@/lib/auth/session";
import { countReveal, revealLimit } from "@/lib/contactBudget";
import { toContactDetails } from "@/lib/directory";
import { claimOnce } from "@/lib/otp/sentOnce";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const POST = withJsonErrors(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireDoctor().catch(() => null);
  if (!me) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const refused = await refuseUnlessApproved(me);
  if (refused) return refused;

  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  const rl = await rateLimit("contactReveal", `doctor:${me.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  // Only a listed doctor has anything to reveal; asking for another id uses no budget.
  const service = createSupabaseServiceClient();
  const found = await service.from("listed_doctors").select("phone_display, phone_e164, email").eq("id", id).maybeSingle();
  if (found.error && found.error.code !== "PGRST116") throw found.error;
  if (!found.data) return jsonError(404, { error: "not_found", code: "not_found" });

  const budget = await countReveal(me.id, id, revealLimit(me.approved_at));
  if (!budget.allowed) {
    // One alert a day per account: someone may be copying the directory.
    if (await claimOnce(`heavy-reveal:${me.id}`, 86_400)) {
      await raiseAlert(service, "directory_heavy_use", { extra: { doctor_id: me.id, reveals: budget.used } });
    }
    return jsonError(429, { error: "reveal_budget", code: "reveal_budget" });
  }

  return jsonOk(toContactDetails(found.data));
});
