// GET /api/search?q=...&specialty_id=...
// Authenticated-doctor search across the directory.
//
// The matching runs in one SQL function, search_directory() (migration
// 20261021084302): Arabic names, subspecialty, certificates, specialty names
// with their subspecialties, workplace names, and workplaces linked to an
// institution matching any of its spellings. Only listed doctors come back.
//
// Speed: a search is two rounds of work in parallel, not a chain of trips.
//   1. the signed-in doctor (session checked locally, one row read), with
//      the institutions list from the cache (lib/cachedReads.ts)
//   2. the rate limit (Redis), with the search query itself
// The usage count is written after the response is sent.

import { after } from "next/server";
import { z } from "zod";
import { cachedInstitutions } from "@/lib/cachedReads";
import { institutionsMatching } from "@/lib/institutions";
import { SEARCH_PAGE_SIZE, toSearchHits } from "@/lib/directory";
import { WORKPLACE_TYPES } from "@/lib/workplace";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import { toIlikeTerm } from "@/lib/normalize/arabic";
import { rateLimit } from "@/lib/ratelimit";
import { ciRunOf } from "@/lib/ciRun";
import { recordEvent } from "@/lib/usage";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Query = z.object({
  q: z.string().trim().max(100).default(""),
  specialty_id: z.uuid().optional(),
  // The filter panel (lib/searchFilters.ts).
  institution_id: z.uuid().optional(),
  workplace_type: z.enum(WORKPLACE_TYPES).optional(),
  stage: z.enum(["specialist", "resident", "general"]).optional(),
  seeking_work: z.literal("1").optional(),
});

export type { SearchHit, SearchWorkplace } from "@/lib/directory";

export const GET = withJsonErrors(async (req: Request) => {
  const started = performance.now();
  const url = new URL(req.url);
  const param = (k: string) => url.searchParams.get(k) || undefined;
  const parsed = Query.safeParse({
    q: url.searchParams.get("q") ?? "",
    specialty_id: param("specialty_id"),
    institution_id: param("institution_id"),
    workplace_type: param("workplace_type"),
    stage: param("stage"),
    seeking_work: param("seeking_work"),
  });

  // requireDoctor, not getCurrentDoctor: a deactivated doctor's session must
  // not keep reading the directory. Its redirect throws, which lands here.
  const [me, institutions] = await Promise.all([requireDoctor().catch(() => null), cachedInstitutions()]);
  if (!me) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }
  if (!parsed.success) {
    return jsonError(400, { error: "invalid_query", code: "invalid_query" });
  }

  const { q, specialty_id, institution_id, workplace_type, stage, seeking_work } = parsed.data;
  // Letters, digits and spaces only, normalised like the stored text: no
  // LIKE wildcards can reach the query.
  const term = toIlikeTerm(q);
  // An all-punctuation query: nothing to search for.
  if (q && !term) {
    const rl = await rateLimit("search", `doctor:${me.id}`);
    if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });
    return jsonOk({ results: [], count: 0, truncated: false });
  }

  const service = createSupabaseServiceClient();
  // ponytail: the query runs alongside the rate limit rather than after it,
  // to save a round trip; a refused caller costs one indexed read, and gets
  // nothing back.
  const [rl, found] = await Promise.all([
    rateLimit("search", `doctor:${me.id}`),
    service.rpc("search_directory", {
      p_term: term || null,
      p_specialty_id: specialty_id ?? null,
      p_institution_ids: term ? institutionsMatching(institutions, q) : [],
      // One extra row tells us whether more matched than we return.
      p_limit: SEARCH_PAGE_SIZE + 1,
      p_workplace_institution: institution_id ?? null,
      p_workplace_type: workplace_type ?? null,
      p_stage: stage ?? null,
      p_seeking_work: seeking_work === "1",
    }),
  ]);
  if (!rl.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }
  // A swallowed error would read as "nobody matched".
  if (found.error) throw found.error;

  const hits = toSearchHits(found.data);
  const results = hits.slice(0, SEARCH_PAGE_SIZE);
  // No search text is kept. A specialty filter that finds nobody tells us
  // which specialties the directory is missing. The production smoke test's
  // searches are not usage (lib/ciRun.ts).
  if (!ciRunOf(req)) {
    after(() =>
      recordEvent(service, "search", {
        doctorId: me.id,
        meta: {
          results: hits.length,
          // The stats' "specialties searched with no result" reads this as
          // a specialty filter; the panel's filters are counted apart.
          filtered: Boolean(specialty_id),
          ...((institution_id || workplace_type || stage || seeking_work) && { panel_filters: true }),
          ...(specialty_id && { specialty_id }),
        },
      }),
    );
  }
  const res = jsonOk({
    results,
    count: results.length,
    truncated: hits.length > SEARCH_PAGE_SIZE,
  });
  // The server's share of a search, visible in the browser's network panel.
  res.headers.set("Server-Timing", `search;dur=${Math.round(performance.now() - started)}`);
  return res;
});
