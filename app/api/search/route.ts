// GET /api/search?q=...&specialty_id=...
// Authenticated-doctor search across the directory.
//
// Visibility: only active, visible, phone-verified, admin-approved, consented
// doctors are returned. The `doctor_visible` view enforces these conditions at
// the relation level; RLS on the underlying `doctors` table provides
// defence-in-depth via the SSR (caller-scoped) client.

import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api/respond";
import { getCurrentDoctor } from "@/lib/auth/session";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildWhatsAppLink } from "@/lib/whatsapp";

const Query = z.object({
  q: z.string().trim().max(100).default(""),
  specialty_id: z.uuid().optional(),
});

export interface SearchHit {
  id: string;
  arabic_first_name: string;
  arabic_family_name: string;
  hebrew_first_name: string;
  hebrew_family_name: string;
  license_number: string;
  /** Null when the doctor opted to hide their phone via /profile. */
  phone_display: string | null;
  /** Null when phone is hidden — disables the WhatsApp button on the card. */
  whatsapp_url: string | null;
  email: string | null;
  subspecialty: string | null;
  specialties: string[];
  /** Empty array when the doctor opted to hide their workplaces. */
  workplaces: { name: string; is_primary: boolean }[];
  profile_picture_url: string | null;
}

export async function GET(req: Request) {
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

  // Read from the doctor_visible view via the SSR (RLS-enforced) client.
  // Visibility contract is enforced at the relation level, so a missed .eq()
  // here cannot leak unapproved rows. The SSR client carries the caller's JWT
  // so RLS on the underlying table also applies as defence in depth.
  const ssr = await createSupabaseServerClient();

  let query = ssr
    .from("doctor_visible")
    .select(
      `
      id,
      arabic_first_name,
      arabic_family_name,
      hebrew_first_name,
      hebrew_family_name,
      license_number,
      phone_display,
      phone_e164,
      phone_is_visible,
      workplaces_is_visible,
      profile_picture_url,
      email,
      subspecialty,
      doctor_specialties${parsed.data.specialty_id ? "!inner" : ""}(
        specialty:specialties(id, name_ar)
      ),
      doctor_workplaces(name, is_primary, sort_order)
    `,
    )
    .order("arabic_full_name", { ascending: true })
    .limit(50);

  if (parsed.data.specialty_id) {
    query = query.eq(
      "doctor_specialties.specialty_id",
      parsed.data.specialty_id,
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
      ssr
        .from("specialties")
        .select("id")
        .or(
          [
            `name_ar_normalized.ilike.${pattern}`,
            `name_ar.ilike.${pattern}`,
          ].join(","),
        ),
      ssr
        .from("doctor_workplaces")
        .select("doctor_id")
        .or(
          [
            `name_normalized.ilike.${pattern}`,
            `name.ilike.${pattern}`,
          ].join(","),
        ),
    ]);

    const specialtyIds = (specialtyMatches.data ?? []).map((r) => r.id);
    const doctorIdsViaSpecialty = specialtyIds.length
      ? (
          await ssr
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

  const results: SearchHit[] = (data ?? []).map((d) => {
    // PostgREST returns nested relations as arrays, even on FK joins.
    const specialties = ((d.doctor_specialties ?? []) as unknown as Array<{
      specialty: { name_ar: string } | { name_ar: string }[] | null;
    }>)
      .flatMap((row) => {
        const s = row.specialty;
        if (!s) return [];
        return Array.isArray(s) ? s.map((x) => x.name_ar) : [s.name_ar];
      })
      .filter((n): n is string => Boolean(n));

    const workplaces = d.workplaces_is_visible
      ? ((d.doctor_workplaces ?? []) as Array<{
          name: string;
          is_primary: boolean;
          sort_order: number;
        }>)
          .slice()
          .sort((a, b) => {
            if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
            return a.sort_order - b.sort_order;
          })
          .map(({ name, is_primary }) => ({ name, is_primary }))
      : [];

    return {
      id: d.id,
      arabic_first_name: d.arabic_first_name,
      arabic_family_name: d.arabic_family_name,
      hebrew_first_name: d.hebrew_first_name,
      hebrew_family_name: d.hebrew_family_name,
      license_number: d.license_number,
      phone_display: d.phone_is_visible ? d.phone_display : null,
      whatsapp_url: d.phone_is_visible ? buildWhatsAppLink(d.phone_e164) : null,
      email: d.email,
      subspecialty: d.subspecialty,
      specialties,
      workplaces,
      profile_picture_url: d.profile_picture_url ?? null,
    };
  });

  return jsonOk({ results, count: results.length });
}
