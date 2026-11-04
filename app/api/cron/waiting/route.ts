// GET /api/cron/waiting, daily at 06:00 UTC (morning in Jerusalem): a new
// doctor's alert goes to one admin at a time, in turn (lib/push.ts), so if that
// admin is away nobody else hears. This tells every admin, once, about each
// doctor who has now waited a day.
//
// Once per doctor, with no storage: a doctor is reported by the run that finds
// them between 24 and 48 hours old, and the runs are a day apart. (A held or
// withdrawn doctor is not nagged about every morning.)
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron).

import { verifyCronAuth } from "@/lib/api/cronAuth";
import { jsonOk, withJsonErrors } from "@/lib/api/respond";
import { raiseAlert } from "@/lib/alerts";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const HOUR = 3_600_000;

export const GET = withJsonErrors(async (req: Request) => {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const service = createSupabaseServiceClient();
  const { count, error } = await service
    .from("doctors")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .eq("is_admin_approved", false)
    .eq("is_admin", false)
    .lt("created_at", new Date(Date.now() - 24 * HOUR).toISOString())
    .gte("created_at", new Date(Date.now() - 48 * HOUR).toISOString());
  if (error) throw error;
  if (count) await raiseAlert(service, "doctor_waiting_long", { extra: { waiting: count } });
  return jsonOk({ ok: true, waiting: count ?? 0 });
});
