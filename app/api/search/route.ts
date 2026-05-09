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
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { getCurrentDoctor } from "@/lib/auth/session";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
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

  const ip = ipFromHeaders(req);
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
  let query = service
    .from("doctors")
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
    .eq("is_active", true)
    .eq("is_visible", true)
    .eq("is_phone_verified", true)
    .eq("is_admin_approved", true)
    .eq("consent_directory_use", true)
    .order("arabic_full_name", { ascending: true })
    .limit(50);

  if (parsed.data.specialty_id) {
    query = query.eq(
      "doctor_specialties.specialty_id",
      parsed.data.specialty_id,
    );
  }

  if (qNorm) {
    // PostgREST `or` — needs commas between alternatives, no spaces.
    // ILIKE patterns use `*` as the wildcard in PostgREST syntax (sent as %).
    const escaped = qNorm.replace(/[*,()]/g, " ");
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

    const specialtyIds = (specialtyMatches.data ?? []).map((r) => r.id);
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
    ];
    if (joinedDoctorIds.length) {
      orFilters.push(`id.in.(${joinedDoctorIds.join(",")})`);
    }
    query = query.or(orFilters.join(","));
  }

  const { data, error } = await query;
  if (error) {
    console.error("[search] query failed", error);
    return jsonError(500, { error: "search_failed", code: "search_failed" });
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

  // Privacy: only the actor + a length bucket are recorded; never the query.
  await service.from("audit_logs").insert({
    actor_doctor_id: me.id,
    action: "search_submitted",
    metadata: {
      q_length: qRaw.length,
      has_specialty_filter: Boolean(parsed.data.specialty_id),
      result_count: results.length,
      ip,
    },
  });

  return jsonOk({ results, count: results.length });
}
