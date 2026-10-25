import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/database.types";
import { cookies } from "next/headers";
import { hardenCookie } from "@/lib/security/cookies";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, hardenCookie(options));
            }
          } catch {
            // Called from a Server Component, where cookies cannot be mutated.
            // Middleware will refresh the session on the next request.
          }
        },
      },
    },
  );
}
