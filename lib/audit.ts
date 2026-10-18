// Appends to audit_logs. A failed write never fails the action it records
// (that has already happened), but it must not vanish silently either, or
// the admin audit page ends up quietly incomplete.

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditRow {
  action: string;
  actor_doctor_id?: string | null;
  target_doctor_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function writeAudit(service: SupabaseClient, row: AuditRow): Promise<void> {
  try {
    const { error } = await service.from("audit_logs").insert(row);
    if (error) throw error;
  } catch (err) {
    console.error(`[audit] ${row.action} not recorded`, err);
    Sentry.captureException(err, { extra: { action: row.action } });
  }
}
