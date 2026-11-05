// What a doctor changed about their own card, for the activity log (#16). An
// admin's edits were always logged; the doctor's own were not, so an accepted
// doctor could rename themselves to a colleague, change their workplaces or
// photo, and nothing showed it. Values are logged only where they identify the
// card (the Arabic name, the workplace names); an email or a bio is logged as
// "changed" without its text.

import type { SupabaseClient } from "@supabase/supabase-js";
import { raiseAlert } from "@/lib/alerts";
import { writeAudit } from "@/lib/audit";
import type { ProfileFields } from "@/lib/profile/save";

interface Self {
  id: string;
  arabic_first_name: string;
  arabic_family_name: string;
  is_admin_approved: boolean;
}

/** Never throws: the save has happened either way. */
export async function recordProfileEdit(
  service: SupabaseClient,
  me: Self,
  parsed: ProfileFields,
  workplaceNames: string[] | null,
): Promise<void> {
  try {
    const fields = Object.entries(parsed)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    if (fields.length === 0) return;

    const before = `${me.arabic_first_name} ${me.arabic_family_name}`;
    const after = `${parsed.arabic_first_name ?? me.arabic_first_name} ${parsed.arabic_family_name ?? me.arabic_family_name}`;
    const renamed = before !== after;

    await writeAudit(service, {
      actor_doctor_id: me.id,
      action: "doctor_profile_edited",
      target_doctor_id: me.id,
      metadata: {
        fields,
        ...(renamed ? { name_before: before, name_after: after } : {}),
        ...(workplaceNames ? { workplace_names: workplaceNames } : {}),
      },
    });
    // A doctor an admin vetted under one name now answers to another.
    if (renamed && me.is_admin_approved) {
      await raiseAlert(service, "doctor_renamed", { logOnly: { doctor_id: me.id, name_before: before, name_after: after } });
    }
  } catch (err) {
    console.error("[profile] edit not recorded", err);
  }
}
