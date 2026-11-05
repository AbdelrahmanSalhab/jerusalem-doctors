// An accepted doctor may not rename themselves to the Arabic name another
// listed doctor already has (#247). The attack the issue describes is a vetted
// account taking a colleague's name, keeping its own Hebrew name and licence,
// and showing up as that colleague in search. The rename is logged and alerted
// either way (lib/profile/audit.ts); this closes the one case that needs no
// judgement. Any other new name still goes through, as an admin's edit does.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeArabic } from "@/lib/normalize/arabic";

interface Self {
  id: string;
  arabic_first_name: string;
  arabic_family_name: string;
  is_admin_approved: boolean;
}

const fullName = (first: string, family: string) => normalizeArabic(`${first} ${family}`);

/** Throws when the lookup fails: a rename is refused rather than let through unchecked. */
export async function nameTakenByAnother(
  service: SupabaseClient,
  me: Self,
  parsed: { arabic_first_name?: string; arabic_family_name?: string },
): Promise<boolean> {
  if (!me.is_admin_approved) return false;
  const next = fullName(parsed.arabic_first_name ?? me.arabic_first_name, parsed.arabic_family_name ?? me.arabic_family_name);
  // Saving the name they already have is not a rename, whoever else shares it.
  if (next === fullName(me.arabic_first_name, me.arabic_family_name)) return false;

  const r = await service.from("listed_doctors").select("id").eq("arabic_full_name_normalized", next).neq("id", me.id).limit(1);
  if (r.error) throw r.error;
  return (r.data ?? []).length > 0;
}
