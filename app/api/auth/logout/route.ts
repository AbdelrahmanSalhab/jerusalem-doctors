// POST /api/auth/logout — kills the Supabase Auth session.
import { jsonOk, withJsonErrors } from "@/lib/api/respond";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const POST = withJsonErrors(async () => {
  const ssr = await createSupabaseServerClient();
  await ssr.auth.signOut();
  return jsonOk({ ok: true });
});
