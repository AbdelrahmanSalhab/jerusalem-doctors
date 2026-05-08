import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return Response.json({ ok: false, db: "unconfigured" }, { status: 503 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("specialties").select("id").limit(1);

    // 42P01 (Postgres) and PGRST205 (PostgREST schema cache) both mean
    // "relation does not exist" — expected before migrations run.
    const preMigration = error?.code === "42P01" || error?.code === "PGRST205";

    if (error && !preMigration) {
      return Response.json({ ok: false, db: error.message }, { status: 503 });
    }

    return Response.json({
      ok: true,
      db: preMigration ? "reachable (pre-migration)" : "reachable",
    });
  } catch (err) {
    return Response.json(
      { ok: false, db: err instanceof Error ? err.message : "unknown" },
      { status: 503 },
    );
  }
}
