// GET /api/search?q=...&specialty_id=...
// Authenticated-doctor search across the directory.
//
// ILIKE on the doctor's normalized Arabic name fields, subspecialty and
// certificates, plus specialty and workplace names resolved to doctor ids.
// Optional specialty filter, also resolved to doctor ids.
//
// Visibility: only active, visible, phone-verified, admin-approved, consented
// doctors are returned. RLS would enforce this even if the query didn't, but
// we filter explicitly so the user-scoped client doesn't have to.

import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { directoryQuery, SEARCH_PAGE_SIZE, toSearchHits } from "@/lib/directory";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { normalizeArabic, toIlikeTerm } from "@/lib/normalize/arabic";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { withSubspecialties } from "@/lib/specialtyTree";

const Query = z.object({
  q: z.string().trim().max(100).default(""),
  specialty_id: z.uuid().optional(),
});

export type { SearchHit, SearchWorkplace } from "@/lib/directory";

/** Ids per query: ~37 bytes each, so 150 keeps a URL well under 8 KB. */
const ID_CHUNK = 150;

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK));
  return out;
}

async function doctorIdsWithSpecialties(
  service: ReturnType<typeof createSupabaseServiceClient>,
  specialtyIds: string[],
): Promise<string[]> {
  if (specialtyIds.length === 0) return [];
  const { data, error } = await service
    .from("doctor_specialties")
    .select("doctor_id")
    .in("specialty_id", specialtyIds);
  if (error) throw error;
  return (data ?? []).map((r) => r.doctor_id as string);
}

export const GET = withJsonErrors(async (req: Request) => {
  // requireDoctor, not getCurrentDoctor: a deactivated doctor's session must
  // not keep reading the directory. Its redirect throws, which lands here.
  const me = await requireDoctor().catch(() => null);
  if (!me) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const rl = await rateLimit("search", `doctor:${me.id}`);
  if (!rl.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({
    q: url.searchParams.get("q") ?? "",
    specialty_id: url.searchParams.get("specialty_id") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, { error: "invalid_query", code: "invalid_query" });
  }

  const qRaw = parsed.data.q;
  const qNorm = normalizeArabic(qRaw);
  const service = createSupabaseServiceClient();
  const empty = () => jsonOk({ results: [], count: 0, truncated: false });

  // PostgREST `or` parses commas, parens, and dots structurally, and
  // backslash / quote characters can break the embedded ILIKE value. We
  // reduce to letters/digits/spaces: searches are by name, specialty, or
  // workplace anyway, none of which need punctuation.
  const escaped = qNorm ? toIlikeTerm(qRaw) : "";
  // All-punctuation query: nothing to search for.
  if (qNorm && !escaped) return empty();
  const pattern = `*${escaped}*`;

  // An internist is stored under their subspecialty only, so a parent
  // (الباطنية) has to match its children too, both in the filter and in the
  // text search. The table is ~30 rows; one read covers both.
  const tree = parsed.data.specialty_id || escaped
    ? ((await service.from("specialties").select("id, parent_id")).data ?? [])
    : [];

  // Doctors in the chosen specialty, as ids. Filtering this way rather than
  // through an inner-joined embed keeps each card's other specialties.
  let allowed: Set<string> | null = null;
  if (parsed.data.specialty_id) {
    allowed = new Set(
      await doctorIdsWithSpecialties(service, withSubspecialties(tree, [parsed.data.specialty_id])),
    );
    if (allowed.size === 0) return empty();
  }

  const page = () =>
    directoryQuery(service)
      .order("arabic_full_name", { ascending: true })
      // One extra row tells us whether more matched than we return.
      .limit(SEARCH_PAGE_SIZE + 1);

  // Id lists can grow with the directory, so they never go into one URL
  // (a few hundred uuids pass the gateway's limit): each chunk is its own
  // query, run in parallel, and the pages are merged below.
  const reads: PromiseLike<{ data: unknown; error: unknown }>[] = [];
  if (escaped) {
    const nameFilter = [
      `arabic_full_name_normalized.ilike.${pattern}`,
      `arabic_first_name_normalized.ilike.${pattern}`,
      `arabic_family_name_normalized.ilike.${pattern}`,
      `subspecialty_normalized.ilike.${pattern}`,
      `certificates_normalized.ilike.${pattern}`,
    ].join(",");
    if (allowed) {
      for (const ids of chunks([...allowed])) reads.push(page().or(nameFilter).in("id", ids));
    } else {
      reads.push(page().or(nameFilter));
    }

    // Arabic-only search (Hebrew search disabled by product decision).
    // Specialty and workplace matches live in joined tables, so they are
    // resolved to doctor ids first.
    const [specialtyMatches, workplaceMatches] = await Promise.all([
      service
        .from("specialties")
        .select("id")
        .or([`name_ar_normalized.ilike.${pattern}`, `name_ar.ilike.${pattern}`].join(",")),
      service
        .from("doctor_workplaces")
        .select("doctor_id")
        .or([`name_normalized.ilike.${pattern}`, `name.ilike.${pattern}`].join(",")),
    ]);
    const specialtyIds = withSubspecialties(
      tree,
      (specialtyMatches.data ?? []).map((r) => r.id),
    );
    const joined = new Set([
      ...(await doctorIdsWithSpecialties(service, specialtyIds)),
      ...(workplaceMatches.data ?? []).map((r) => r.doctor_id as string),
    ]);
    const joinedIds = [...joined].filter((id) => !allowed || allowed.has(id));
    for (const ids of chunks(joinedIds)) reads.push(page().in("id", ids));
  } else if (allowed) {
    for (const ids of chunks([...allowed])) reads.push(page().in("id", ids));
  } else {
    reads.push(page());
  }

  const pages = await Promise.all(reads);
  const failed = pages.find((r) => r.error);
  if (failed) {
    // Report it: an empty list here would read as "nobody matched".
    console.error("[search] query failed", failed.error);
    Sentry.captureException(failed.error, { tags: { route: "search" } });
    return jsonError(500, { error: "search_failed", code: "search_failed" });
  }
  const byId = new Map<string, { id: string; arabic_full_name?: string }>();
  for (const r of pages) {
    for (const row of (r.data ?? []) as { id: string; arabic_full_name?: string }[]) {
      byId.set(row.id, row);
    }
  }
  const data = [...byId.values()].sort((a, b) =>
    (a.arabic_full_name ?? "").localeCompare(b.arabic_full_name ?? "", "ar"),
  );

  const hits = toSearchHits(data);
  const results = hits.slice(0, SEARCH_PAGE_SIZE);
  return jsonOk({
    results,
    count: results.length,
    truncated: hits.length > SEARCH_PAGE_SIZE,
  });
});
