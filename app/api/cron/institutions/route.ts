// GET /api/cron/institutions: daily upkeep of the institutions list (0016).
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}`, like the other crons.
//
// Re-links every workplace to its hospital or health fund (catching rows a
// failed save left unlinked, and applying list edits everywhere), then tells
// the developers which hospital and fund names no institution claims, so
// they can add a spelling or a new institution at /admin/institutions.

import { verifyCronAuth } from "@/lib/api/cronAuth";
import { jsonOk, withJsonErrors } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit";
import { raiseAlert } from "@/lib/alerts";
import { relinkWorkplaces } from "@/lib/institutions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withJsonErrors(async (req: Request) => {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const service = createSupabaseServiceClient();
  const { changed, unmatched } = await relinkWorkplaces(service);

  if (unmatched.length > 0) {
    // One issue per day's list; the alert rule in the runbook turns it into
    // an email. Names are institutions, not people.
    await raiseAlert(service, "unknown_workplaces", {
      extra: { count: unmatched.length },
      // Names doctors typed: the activity log only, not Sentry.
      logOnly: { institutions: unmatched.slice(0, 30) },
    });
  }
  await writeAudit(service, {
    action: "institutions_relinked",
    metadata: { changed, unmatched: unmatched.length },
  });

  return jsonOk({ ok: true, changed, unmatched: unmatched.length });
});
