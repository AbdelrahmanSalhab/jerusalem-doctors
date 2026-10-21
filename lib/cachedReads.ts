// Reads that rarely change, cached across requests and instances (Next's
// data cache, which Vercel keeps durable), so they stop costing a database
// round trip on every request. Server-only: client components import the
// plain modules these wrap.
//
// Each has a tag; the code that edits the data clears it straight away, and
// the hour is only a backstop for an edit made outside the app (SQL editor).

import { revalidateTag, unstable_cache } from "next/cache";
import { fetchInstitutions } from "@/lib/institutions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const HOUR = 3600;

/** The institutions list with every spelling; read on every search. */
export const cachedInstitutions = unstable_cache(
  () => fetchInstitutions(createSupabaseServiceClient()),
  ["institutions"],
  { tags: ["institutions"], revalidate: HOUR },
);

/** After an admin adds, edits or deletes an institution: the next search
 *  reads the new list rather than a stale one. */
export function institutionsChanged(): void {
  revalidateTag("institutions", { expire: 0 });
}
