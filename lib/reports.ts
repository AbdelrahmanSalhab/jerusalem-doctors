// Profile reports (#30): someone says a profile is not who it claims to be.
// Both ways in (a card's button, the public /report form) end here: the row,
// the activity log entry and the admin alert. A report never suspends anyone
// on its own; the admin reviews it under /admin/reports.

import type { SupabaseClient } from "@supabase/supabase-js";
import { raiseAlert } from "@/lib/alerts";
import { writeAudit } from "@/lib/audit";
import { ilLicenseCandidates } from "@/lib/normalize/license";

export interface NewReport {
  source: "card" | "public";
  target_doctor_id: string | null;
  license_number?: string | null;
  reporter_doctor_id?: string | null;
  reporter_name?: string | null;
  reporter_contact?: string | null;
  details: string;
}

export async function fileReport(service: SupabaseClient, report: NewReport): Promise<void> {
  const r = await service.from("profile_reports").insert(report).select("id").single();
  if (r.error) throw new Error(`profile_reports insert failed: ${r.error.message}`);
  await writeAudit(service, {
    actor_doctor_id: report.reporter_doctor_id ?? null,
    action: "profile_reported",
    target_doctor_id: report.target_doctor_id,
    metadata: { source: report.source, report_id: r.data.id },
  });
  // No names or contact details: those stay in the report itself.
  await raiseAlert(service, "profile_reported", { extra: { source: report.source, report_id: r.data.id } });
}

/** The doctor holding a licence number as typed on the public form, either
 *  slot, or null. An IL number may be typed as the registry prints it. */
export async function doctorByLicense(service: SupabaseClient, typed: string): Promise<string | null> {
  const candidates = ilLicenseCandidates(typed) ?? [typed.trim()];
  const safe = candidates.filter((c) => /^[\w-]{1,20}$/.test(c));
  if (safe.length === 0) return null;
  const list = safe.join(",");
  const { data, error } = await service
    .from("doctors")
    .select("id")
    .or(`license_number.in.(${list}),secondary_license_number.in.(${list})`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`doctors read failed: ${error.message}`);
  return data?.id ?? null;
}
