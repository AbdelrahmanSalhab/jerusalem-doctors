// GET /api/cron/sync-moh, the nightly MoH registry refresh (plan §13).
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron sends
// this automatically when configured in vercel.json.
//
// It used to copy the whole registry, 65k rows in 65 requests, to answer
// questions about a few dozen doctors. Now it asks only for our doctors'
// Israeli licences, a few hundred per request (lib/moh/client.ts), and
// `moh_practitioners` keeps only those: a licence someone signs up with is
// fetched on the spot (lib/moh/match.ts). Fewer requests to the one source we
// cannot do without, and no copy of 57k people's details we have no use for.
//
// A licence we asked for that the registry no longer lists is dropped too,
// so /admin shows it as missing rather than as last seen. The count is in the
// audit entry.
//
// Runs at 04:00 UTC: the ministry republishes the registry at about 03:12.

import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/api/cronAuth";
import { jsonOk, withJsonErrors } from "@/lib/api/respond";
import { MohClient } from "@/lib/moh/client";
import { saveRegistryRows, toRegistryRows } from "@/lib/moh/registry";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withJsonErrors(async (req: Request) => {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const startedAt = Date.now();
  const supabase = createSupabaseServiceClient();

  let asked: number[] = [];
  let kept: number[] = [];
  try {
    asked = await ourLicenses(supabase);
    const rows = toRegistryRows(await new MohClient().findByLicenses(asked));
    await saveRegistryRows(supabase, rows);
    kept = rows.map((r) => r.license_number);
    // Everything else goes: earlier signups' lookups, the old full copy, and
    // licences the registry stopped listing.
    // ponytail: the kept list rides in the URL; past ~1500 doctors, prune by
    // synced_at older than this run instead.
    const { error } = await supabase
      .from("moh_practitioners")
      .delete()
      .not("license_number", "in", `(${kept.join(",") || 0})`);
    if (error) throw new Error(`moh_practitioners prune failed: ${error.message}`);
  } catch (err) {
    console.error("[cron/sync-moh] failed", err);
    await writeAudit(supabase, {
      action: "moh_sync_failed",
      metadata: {
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startedAt,
      },
    });
    return NextResponse.json({ ok: false, error: "sync_failed" }, { status: 500 });
  }

  const summary = {
    rows_upserted: kept.length,
    missing: asked.length - kept.length,
    duration_ms: Date.now() - startedAt,
  };
  await writeAudit(supabase, { action: "moh_sync_completed", metadata: summary });
  return jsonOk({ ok: true, ...summary });
});

/** Every Israeli licence on a doctor's account, primary or secondary. */
async function ourLicenses(supabase: ReturnType<typeof createSupabaseServiceClient>): Promise<number[]> {
  const { data, error } = await supabase
    .from("doctors")
    .select("license_number, license_region, secondary_license_number, secondary_license_region");
  if (error) throw new Error(`doctors read failed: ${error.message}`);
  const serials = (data ?? []).flatMap((d) => [
    d.license_region === "IL" ? d.license_number : null,
    d.secondary_license_region === "IL" ? d.secondary_license_number : null,
  ]);
  return [...new Set(serials.filter((s): s is string => !!s && /^\d{1,9}$/.test(s)).map(Number))];
}
