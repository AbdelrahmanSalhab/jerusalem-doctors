import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

const DB_TIMEOUT_MS = 15_000;

/**
 * Service-role client. Bypasses RLS. Server-only, never import from a
 * Client Component or expose the key to the browser.
 */
export function createSupabaseServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      // supabase-js sets no timeout; a stalled request would hold the
      // function until the platform kills it. Generous enough for uploads.
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(DB_TIMEOUT_MS) }) },
    },
  );
}
