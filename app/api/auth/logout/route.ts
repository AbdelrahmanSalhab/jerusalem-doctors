// POST /api/auth/logout — kills the Supabase Auth session.
import { jsonOk } from "@/lib/api/respond";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const ssr = await createSupabaseServerClient();
  await ssr.auth.signOut();
  return jsonOk({ ok: true });
}
