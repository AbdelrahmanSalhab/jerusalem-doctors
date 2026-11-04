// GET /api/cron/metrics, daily at 00:30 UTC: records the day before in
// metrics_daily (record_daily_metrics(), migration 20261021102333), so
// /admin/stats shows measured usage instead of estimates, and raises an alert
// when the database passes 70% of Supabase's free plan. Also the daily
// housekeeping: unfinished signups older than 30 days are deleted
// (lib/signup/unfinished.ts), so they go even on days nobody signs up.
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron).

import { verifyCronAuth } from "@/lib/api/cronAuth";
import { jsonOk, withJsonErrors } from "@/lib/api/respond";
import { raiseAlert } from "@/lib/alerts";
import { DB_LIMIT_BYTES } from "@/lib/limits";
import { purgeUnfinished } from "@/lib/signup/unfinished";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** A new doctor's alert goes to one admin, in turn; if that admin is away, no
 *  one else hears. So once a day, anyone waiting over WAITING_ALERT_HOURS is
 *  told to every admin. Returns how many wait that long. */
const WAITING_ALERT_HOURS = 24;
async function alertIfWaitingLong(service: ReturnType<typeof createSupabaseServiceClient>): Promise<number> {
  const before = new Date(Date.now() - WAITING_ALERT_HOURS * 3_600_000).toISOString();
  const { count, error } = await service
    .from("doctors")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .eq("is_admin_approved", false)
    .eq("is_admin", false)
    .lt("created_at", before);
  if (error) throw error;
  if (count) await raiseAlert(service, "doctor_waiting_long", { extra: { waiting: count } });
  return count ?? 0;
}

export const GET = withJsonErrors(async (req: Request) => {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  // The UTC day that just ended.
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("record_daily_metrics", { p_day: day });
  if (error) throw error;

  const { db_bytes } = data as { db_bytes: number };
  if (db_bytes > DB_LIMIT_BYTES * 0.7) {
    await raiseAlert(service, "db_size_high", { extra: { db_bytes, limit_bytes: DB_LIMIT_BYTES } });
  }
  const waiting = await alertIfWaitingLong(service);
  const unfinished_deleted = await purgeUnfinished(service);
  return jsonOk({ ok: true, day, db_bytes, unfinished_deleted, waiting });
});
