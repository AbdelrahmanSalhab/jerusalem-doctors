// GET /api/search?q=...&specialty_id=...
// Authenticated-doctor search across the directory.
//
// MVP search (plan §8): ILIKE on the doctor's normalized Arabic name fields,
// Hebrew full name, normalized subspecialty, and normalized workplace names.
// Optional specialty filter via doctor_specialties join.
//
// Visibility: only active, visible, phone-verified, admin-approved, consented
// doctors are returned. RLS would enforce this even if the query didn't, but
// we filter explicitly so the user-scoped client doesn't have to.

import { z } from "zod";
import { directoryQuery, toSearchHits } from "@/lib/directory";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { getCurrentDoctor } from "@/lib/auth/session";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { withSubspecialties } from "@/lib/specialtyTree";

const Query = z.object({
  q: z.string().trim().max(100).default(""),
  specialty_id: z.uuid().optional(),
});

export type { SearchHit, SearchWorkplace } from "@/lib/directory";

export const GET = withJsonErrors(async (req: Request) => {
  const me = await getCurrentDoctor().catch(() => null);
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

  // Use service-role + manual visibility filter — simpler than threading the
  // user-scoped client through nested selects, and the RLS contract is
  // duplicated here for defense-in-depth.
  let query = directoryQuery(service, Boolean(parsed.data.specialty_id))
    .order("arabic_full_name", { ascending: true })
    .limit(50);

  // An internist is stored under their subspecialty only, so a parent
  // (الباطنية) has to match its children too, both here and in the text
  // search below. The table is ~30 rows; one read covers both.
  const needsTree = Boolean(parsed.data.specialty_id || qNorm);
  const specialtyTree = needsTree
    ? ((await service.from("specialties").select("id, parent_id")).data ?? [])
    : [];

  if (parsed.data.specialty_id) {
    query = query.in(
      "doctor_specialties.specialty_id",
      withSubspecialties(specialtyTree, [parsed.data.specialty_id]),
    );
  }

  if (qNorm) {
    // PostgREST `or` parses commas, parens, and dots structurally, and
    // backslash / quote characters can break the embedded ILIKE value. We
    // reduce to letters/digits/spaces — searches are by name, specialty, or
    // workplace anyway, none of which need punctuation.
    const escaped = qNorm.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
    if (!escaped) {
      // All-punctuation query → return empty results (no DB call).
      return jsonOk({ results: [], count: 0 });
    }
    const pattern = `*${escaped}*`;

    // Arabic-only search (Hebrew search disabled by product decision).
    // Specialty + workplace matches live in joined tables, so we pre-resolve
    // their doctor IDs and OR them into the main filter.
    const [specialtyMatches, workplaceMatches] = await Promise.all([
      service
        .from("specialties")
        .select("id")
        .or(
          [
            `name_ar_normalized.ilike.${pattern}`,
            `name_ar.ilike.${pattern}`,
          ].join(","),
        ),
      service
        .from("doctor_workplaces")
        .select("doctor_id")
        .or(
          [
            `name_normalized.ilike.${pattern}`,
            `name.ilike.${pattern}`,
          ].join(","),
        ),
    ]);

    const specialtyIds = withSubspecialties(
      specialtyTree,
      (specialtyMatches.data ?? []).map((r) => r.id),
    );
    const doctorIdsViaSpecialty = specialtyIds.length
      ? (
          await service
            .from("doctor_specialties")
            .select("doctor_id")
            .in("specialty_id", specialtyIds)
        ).data?.map((r) => r.doctor_id) ?? []
      : [];

    const doctorIdsViaWorkplace =
      (workplaceMatches.data ?? []).map((r) => r.doctor_id);

    const joinedDoctorIds = Array.from(
      new Set([...doctorIdsViaSpecialty, ...doctorIdsViaWorkplace]),
    );

    const orFilters = [
      `arabic_full_name_normalized.ilike.${pattern}`,
      `arabic_first_name_normalized.ilike.${pattern}`,
      `arabic_family_name_normalized.ilike.${pattern}`,
      `subspecialty_normalized.ilike.${pattern}`,
      `certificates_normalized.ilike.${pattern}`,
    ];
    if (joinedDoctorIds.length) {
      orFilters.push(`id.in.(${joinedDoctorIds.join(",")})`);
    }
    query = query.or(orFilters.join(","));
  }

  const { data, error } = await query;
  if (error) {
    // Don't 500 on bad input — log it and return empty results so the UI
    // shows "no matches" instead of "something went wrong".
    console.error("[search] query failed", error);
    return jsonOk({ results: [], count: 0 });
  }

  const results = toSearchHits(data);
  return jsonOk({ results, count: results.length });
});
