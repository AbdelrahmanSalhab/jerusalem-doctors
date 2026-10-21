// Reads that rarely change, cached across requests and instances (Next's
// data cache, which Vercel keeps durable), so they stop costing a database
// round trip on every request. Server-only: client components import the
// plain modules these wrap.
//
// Each has a tag; the code that edits the data clears it straight away, and
// the hour is only a backstop for an edit made outside the app (SQL editor).

import { revalidateTag, unstable_cache } from "next/cache";
import { fetchDirectoryCounts, fetchFeatured, fetchRecent } from "@/lib/directory";
import { fetchInstitutions } from "@/lib/institutions";
import { fetchActiveSpecialties } from "@/lib/specialties/catalogue";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const HOUR = 3600;

/** Clears a tag now. The save that called it has already happened, so a
 *  failure here is logged, not thrown: the hour or minute backstop below
 *  still refreshes the data. */
function clear(tag: string): void {
  try {
    revalidateTag(tag, { expire: 0 });
  } catch (err) {
    console.error(`[cache] could not clear ${tag}`, err);
  }
}
/** The dashboard's counts and featured doctors change with every signup,
 *  approval and profile edit, far too many writers to clear by hand; a
 *  minute old is fine for "how many doctors" and a featured card. */
const MINUTE = 60;

/** The institutions list with every spelling; read on every search. */
export const cachedInstitutions = unstable_cache(
  () => fetchInstitutions(createSupabaseServiceClient()),
  ["institutions"],
  { tags: ["institutions"], revalidate: HOUR },
);

/** After an admin adds, edits or deletes an institution: the next search
 *  reads the new list rather than a stale one. */
export function institutionsChanged(): void {
  clear("institutions");
}

/** Active specialties in display order: signup, profile, dashboard chips. */
export const cachedSpecialties = unstable_cache(
  () => fetchActiveSpecialties(createSupabaseServiceClient()),
  ["specialties"],
  { tags: ["specialties"], revalidate: HOUR },
);

/** After an admin adds or edits a specialty. */
export function specialtiesChanged(): void {
  clear("specialties");
}

/** What every doctor's dashboard shows the same: the featured doctors, the
 *  counts, and who joined this week (ranked per viewer on the page). */
async function directoryOverview() {
  const service = createSupabaseServiceClient();
  const [featured, counts, recent] = await Promise.all([
    fetchFeatured(service),
    fetchDirectoryCounts(service),
    fetchRecent(service),
  ]);
  return { featured, counts, recent };
}
/** 0 turns this cache off: the e2e run sets it, because its tests change
 *  doctors straight in the database, where nothing clears the tag. */
const DIRECTORY_TTL = Number(process.env.DIRECTORY_CACHE_SECONDS ?? MINUTE);
export const cachedDirectoryOverview =
  DIRECTORY_TTL > 0
    ? unstable_cache(directoryOverview, ["directory-overview"], { tags: ["directory"], revalidate: DIRECTORY_TTL })
    : directoryOverview;

/** After an admin approves, hides, closes or features a doctor: the
 *  dashboard shows it at once rather than within the minute. */
export function directoryChanged(): void {
  clear("directory");
}
