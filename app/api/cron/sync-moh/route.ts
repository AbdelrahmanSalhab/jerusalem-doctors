// GET /api/cron/sync-moh, the nightly MoH registry refresh (plan §13).
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron sends
// this automatically when configured in vercel.json.
//
// The registry is the source we cannot do without, so it is asked as little
// as we can while signup still answers from a full copy:
// - once a week, the whole registry: about 65 requests, a second apart. That
//   copy is what a signup checks first, so a doctor is verified without a
//   live call (a licence issued since is fetched live and kept, lib/moh/match.ts)
// - every other night, only our own doctors' licences: one request per 300
//
// Either way, an Israeli licence on one of our doctors that the registry no
// longer lists is flagged: its status becomes not_found, which puts the
// doctor in the admin's licence review list, with an audit entry and a
// Sentry warning. Nobody is hidden or blocked; an admin decides.
//
// Runs at 04:00 UTC: the ministry republishes the registry at about 03:12.

import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/api/cronAuth";
import { jsonOk, withJsonErrors } from "@/lib/api/respond";
import { MohClient } from "@/lib/moh/client";
import { saveRegistryRows, toRegistryRows, type RegistryRow } from "@/lib/moh/registry";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";
import { raiseAlert } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // the weekly sweep: ~65 paced requests, 57k licences

type Service = ReturnType<typeof createSupabaseServiceClient>;

const FULL_SWEEP_EVERY_MS = 6.5 * 86_400_000;
/** A sweep that shrinks the copy by more than this is a broken answer. */
const FULL_SWEEP_MIN_SHARE = 0.9;

export const GET = withJsonErrors(async (req: Request) => {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const started = new Date();
  const supabase = createSupabaseServiceClient();
  try {
    const doctors = await ourDoctors(supabase);
    const ours = [...new Set(doctors.flatMap((d) => d.licenses.map((l) => l.number)))];
    const full = await fullSweepDue(supabase, started);

    const client = new MohClient();
    const rows = toRegistryRows(full ? await client.findAll() : await client.findByLicenses(ours), started);
    const found = new Set(rows.map((r) => r.license_number));
    const missing = ours.filter((n) => !found.has(n));
    assertPlausible(full ? await copySize(supabase) : 0, rows, ours, missing);

    for (let i = 0; i < rows.length; i += 500) await saveRegistryRows(supabase, rows.slice(i, i + 500));
    await dropUnlisted(supabase, full, started, missing);
    const flagged = await flagMissing(supabase, doctors, new Set(missing));

    const summary = {
      scope: full ? "full" : "ours",
      rows_upserted: rows.length,
      missing: missing.length,
      flagged,
      duration_ms: Date.now() - started.getTime(),
    };
    await writeAudit(supabase, { action: "moh_sync_completed", metadata: summary });
    return jsonOk({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron/sync-moh] failed", err);
    await writeAudit(supabase, {
      action: "moh_sync_failed",
      metadata: { error: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - started.getTime() },
    });
    return NextResponse.json({ ok: false, error: "sync_failed" }, { status: 500 });
  }
});

interface OurDoctor {
  id: string;
  licenses: { slot: "primary" | "secondary"; number: number; status: string | null }[];
}

/** Every doctor's Israeli licences, primary and secondary. */
async function ourDoctors(supabase: Service): Promise<OurDoctor[]> {
  const { data, error } = await supabase
    .from("doctors")
    .select(
      "id, license_number, license_region, license_verification_status, secondary_license_number, secondary_license_region, secondary_license_verification_status",
    )
    // Not the non-doctor admin rows: their licence is a placeholder (the same
    // rule as the admin list's licence filter).
    .or("is_admin.eq.false,is_visible.eq.true");
  if (error) throw new Error(`doctors read failed: ${error.message}`);
  const serial = (region: string | null, n: string | null) => (region === "IL" && n && /^\d{1,9}$/.test(n) ? Number(n) : null);
  return (data ?? []).map((d) => ({
    id: d.id,
    licenses: [
      { slot: "primary" as const, number: serial(d.license_region, d.license_number), status: d.license_verification_status },
      {
        slot: "secondary" as const,
        number: serial(d.secondary_license_region, d.secondary_license_number),
        status: d.secondary_license_verification_status,
      },
    ].filter((l): l is OurDoctor["licenses"][number] & { number: number } => l.number !== null),
  }));
}

/** Due when no full sweep has completed in the last 6.5 days. */
async function fullSweepDue(supabase: Service, now: Date): Promise<boolean> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id")
    .eq("action", "moh_sync_completed")
    .eq("metadata->>scope", "full")
    .gte("created_at", new Date(now.getTime() - FULL_SWEEP_EVERY_MS).toISOString())
    .limit(1);
  if (error) throw new Error(`audit read failed: ${error.message}`);
  return (data ?? []).length === 0;
}

async function copySize(supabase: Service): Promise<number> {
  const { count, error } = await supabase.from("moh_practitioners").select("license_number", { count: "exact", head: true });
  if (error) throw new Error(`moh_practitioners count failed: ${error.message}`);
  return count ?? 0;
}

/** Refuses an answer that would flag or delete on bad data. `copy` is the
 *  size of the copy before a full sweep, 0 when this run is not one. */
function assertPlausible(copy: number, rows: RegistryRow[], ours: number[], missing: number[]) {
  if (rows.length < copy * FULL_SWEEP_MIN_SHARE) {
    throw new Error(`registry sweep returned ${rows.length} licences; the copy has ${copy}`);
  }
  if (ours.length >= 10 && missing.length > ours.length / 2) {
    throw new Error(`registry is missing ${missing.length} of our ${ours.length} licences; not trusting it`);
  }
}

/** The copy follows the registry: rows it no longer lists go. */
async function dropUnlisted(supabase: Service, full: boolean, started: Date, missing: number[]) {
  const query = supabase.from("moh_practitioners").delete();
  const { error } = full
    ? // Every listed licence was just rewritten with this run's time.
      await query.lt("synced_at", started.toISOString())
    : missing.length > 0
      ? await query.in("license_number", missing)
      : { error: null };
  if (error) throw new Error(`moh_practitioners prune failed: ${error.message}`);
}

/** Marks our doctors' licences the registry no longer lists, once each. */
async function flagMissing(supabase: Service, doctors: OurDoctor[], missing: Set<number>): Promise<number> {
  const column = { primary: "license_verification_status", secondary: "secondary_license_verification_status" };
  let flagged = 0;
  for (const d of doctors) {
    for (const l of d.licenses) {
      if (!missing.has(l.number) || l.status === "not_found") continue;
      const { error } = await supabase.from("doctors").update({ [column[l.slot]]: "not_found" }).eq("id", d.id);
      if (error) throw new Error(`doctors flag failed: ${error.message}`);
      await writeAudit(supabase, {
        action: "license_missing_from_registry",
        target_doctor_id: d.id,
        metadata: { slot: l.slot, license_number: String(l.number), license_status_before: l.status },
      });
      flagged++;
    }
  }
  if (flagged > 0) await raiseAlert(supabase, "licenses_missing", { extra: { flagged } });
  return flagged;
}
