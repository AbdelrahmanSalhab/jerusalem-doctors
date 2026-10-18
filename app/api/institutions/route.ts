// GET /api/institutions: names for the workplace field's suggestions, on
// /signup (public) and /profile. Institution names are public knowledge;
// ids and spellings stay server-side.

import { jsonOk, withJsonErrors } from "@/lib/api/respond";
import { fetchInstitutions } from "@/lib/institutions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const GET = withJsonErrors(async () => {
  const list = await fetchInstitutions(createSupabaseServiceClient());
  return jsonOk(
    { institutions: list.map((i) => ({ name: i.name_ar, kind: i.kind })) },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
});
