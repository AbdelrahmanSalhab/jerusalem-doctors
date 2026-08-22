// GET /api/cron/sync-moh — daily MoH practitioners sync (plan §13).
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron sends
// this automatically when configured in vercel.json.
//
// Behavior: paginate CKAN datastore_search in 1000-row chunks; upsert into
// `moh_practitioners`; record stats in `audit_logs`. Idempotent — safe to
// re-run on failure.

import { NextResponse } from "next/server";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { MohClient } from "@/lib/moh/client";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — full snapshot is ~3MB / 63k rows

export const GET = withJsonErrors(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return jsonError(500, { error: "cron_unconfigured" });
    }
    // dev: allow without secret so it can be triggered locally for testing
  } else {
    const authz = req.headers.get("authorization");
    if (authz !== `Bearer ${secret}`) {
      return jsonError(401, { error: "unauthorized" });
    }
  }

  const startedAt = Date.now();
  const client = new MohClient();
  const supabase = createSupabaseServiceClient();

  let upserted = 0;
  let batch: NonNullable<ReturnType<typeof toRow>>[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    // Registry has multiple rows per license (one per specialty cert).
    // Dedupe within the batch so ON CONFLICT doesn't see the same key twice
    // in a single statement. Cross-batch duplicates are fine — successive
    // upserts just overwrite via ON CONFLICT.
    const seen = new Set<number>();
    const deduped = batch.filter((r) => {
      if (seen.has(r.license_number)) return false;
      seen.add(r.license_number);
      return true;
    });
    const { error } = await supabase
      .from("moh_practitioners")
      .upsert(deduped, { onConflict: "license_number" });
    if (error) throw new Error(`moh upsert failed: ${error.message}`);
    upserted += deduped.length;
    batch = [];
  };

  try {
    for await (const rec of client.iterateAll(1000)) {
      const row = toRow(rec);
      if (!row) continue;
      batch.push(row);
      if (batch.length >= 500) await flush();
    }
    await flush();
  } catch (err) {
    console.error("[cron/sync-moh] failed", err);
    await supabase.from("audit_logs").insert({
      action: "moh_sync_failed",
      metadata: {
        error: err instanceof Error ? err.message : String(err),
        rows_upserted: upserted,
        duration_ms: Date.now() - startedAt,
      },
    });
    return NextResponse.json(
      { ok: false, upserted, error: "sync_failed" },
      { status: 500 },
    );
  }

  await supabase.from("audit_logs").insert({
    action: "moh_sync_completed",
    metadata: {
      rows_upserted: upserted,
      duration_ms: Date.now() - startedAt,
    },
  });

  return jsonOk({
    ok: true,
    rows_upserted: upserted,
    duration_ms: Date.now() - startedAt,
  });
});

function toRow(rec: {
  "מספר רישיון רופא": number;
  "שם פרטי": string;
  "שם משפחה": string;
  "שם התמחות"?: string | null;
  "תאריך רישום רישיון"?: number | null;
}): {
  license_number: number;
  hebrew_first_name: string;
  hebrew_family_name: string;
  hebrew_first_norm: string;
  hebrew_family_norm: string;
  specialty_name_he: string | null;
  license_issued_yyyymmdd: number | null;
  synced_at: string;
} | null {
  const lic = rec["מספר רישיון רופא"];
  const first = rec["שם פרטי"];
  const family = rec["שם משפחה"];
  if (!Number.isInteger(lic) || lic <= 0 || !first || !family) return null;
  return {
    license_number: lic,
    hebrew_first_name: first,
    hebrew_family_name: family,
    hebrew_first_norm: normalizeHebrew(first),
    hebrew_family_norm: normalizeHebrew(family),
    specialty_name_he: rec["שם התמחות"] ?? null,
    license_issued_yyyymmdd: rec["תאריך רישום רישיון"] ?? null,
    synced_at: new Date().toISOString(),
  };
}
