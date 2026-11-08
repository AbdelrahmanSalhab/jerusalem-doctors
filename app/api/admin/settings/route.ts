// PATCH /api/admin/settings: flip one or both of the directory's switches
// (lib/siteSettings.ts). Each is a protection #16 added, so a change is
// written to the activity log with who made it, and turning one on also tells
// the other admins (the alert is for the log and their phones).

import { z } from "zod";
import { raiseAlert } from "@/lib/alerts";
import { jsonError, jsonOk, withJsonErrors, zodFields } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { siteSettingsChanged } from "@/lib/cachedReads";
import { fetchSiteSettings, SETTING_KEYS } from "@/lib/siteSettings";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Patch = z
  .object({ search_before_review: z.boolean().optional(), contacts_without_tap: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "no_settings" });

export const PATCH = withJsonErrors(async (req: Request) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, { error: "invalid_body", code: "invalid_body", fields: zodFields(parsed.error) });
  }

  const service = createSupabaseServiceClient();
  // Read fresh, not from the cache: this is the value the change is measured against.
  const before = await fetchSiteSettings(service);
  const changed = SETTING_KEYS.filter((k) => parsed.data[k] !== undefined && parsed.data[k] !== before[k]);
  if (changed.length === 0) return jsonOk({ ...before, unchanged: true });

  const patch = Object.fromEntries(changed.map((k) => [k, parsed.data[k]]));
  const saved = await service
    .from("site_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (saved.error) throw saved.error;
  siteSettingsChanged();

  for (const setting of changed) {
    const enabled = parsed.data[setting] === true;
    await writeAudit(service, { actor_doctor_id: admin.id, action: "directory_setting_changed", metadata: { setting, enabled } });
    if (enabled) await raiseAlert(service, "directory_setting_on", { extra: { setting, doctor_id: admin.id } });
  }
  return jsonOk({ ...before, ...patch });
});
