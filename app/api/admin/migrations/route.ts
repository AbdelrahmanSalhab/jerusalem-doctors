// GET /api/admin/migrations: the SQL files this database has run, by name
// (applied_migrations). The production smoke check compares them with the
// repo's supabase/migrations, so a file nobody ran is caught after the
// deploy rather than when its feature breaks.

import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const GET = withJsonErrors(async () => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const { data, error } = await createSupabaseServiceClient().from("applied_migrations").select("name").order("name");
  if (error) throw error;
  return jsonOk({ applied: data.map((r) => r.name) });
});
