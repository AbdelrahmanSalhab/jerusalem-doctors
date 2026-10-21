// GET /api/cron/metrics, daily at 00:30 UTC: records the day before in
// metrics_daily (record_daily_metrics(), migration 20261021102333), so
// /admin/stats shows measured usage instead of estimates, and raises an alert
// when the database passes 70% of Supabase's free plan.
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron).

import { verifyCronAuth } from "@/lib/api/cronAuth";
import { jsonOk, withJsonErrors } from "@/lib/api/respond";
import { raiseAlert } from "@/lib/alerts";
import { DB_LIMIT_BYTES } from "@/lib/limits";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

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
  return jsonOk({ ok: true, day, db_bytes });
});
