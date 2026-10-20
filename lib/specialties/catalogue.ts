// The specialty list a picker needs: active rows in display order, with the
// parent links SpecialtyPicker groups by. Read the same way wherever a
// profile is edited — the doctor's own page and the admin panel.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SpecialtyNode } from "@/lib/specialtyTree";

export type SpecialtyChoice = SpecialtyNode & { code: string | null };

export async function fetchActiveSpecialties(service: SupabaseClient): Promise<SpecialtyChoice[]> {
  const { data, error } = await service
    .from("specialties")
    .select("id, name_ar, code, parent_id")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as SpecialtyChoice[];
}
