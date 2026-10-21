// PATCH /api/admin/doctors/[id]/profile
//
// An admin editing any part of a doctor's profile. Everything /api/profile
// allows, plus the three things a doctor cannot change for themselves: the
// Hebrew name the licence matcher compares against the registry, the phone
// number, and whether that phone counts as verified.
//
// Not here, because they already have routes that own their rules:
//   is_admin_approved / is_active / is_visible / featured  -> [id]/route.ts
//   license_*                                              -> [id]/license/*
//   profile_picture_url                                    -> [id]/photo
// And not anywhere: is_admin (privilege escalation from a form), and
// consent_directory_use, which is the doctor's own consent to be listed —
// lib/admin/doctorState.ts already tells admins they cannot change it.
//
// The phone is the login identity. Changing it moves auth.users too, and the
// two stores must never disagree: a doctor whose row says one number and
// whose login expects another can sign in with neither.

import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors, zodFields } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { writeAudit } from "@/lib/audit";
import {
  AdminProfileFieldsSchema,
  buildProfileUpdates,
  buildWorkplaceRows,
  saveProfileTransaction,
  workplacesRuleFailure,
  type SaveFailure,
} from "@/lib/profile/save";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import {
  formatPhoneDisplay,
  InvalidPhoneError,
  isSmsDeliverable,
  maskPhone,
  normalizePhone,
} from "@/lib/normalize/phone";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { directoryChanged } from "@/lib/cachedReads";

const CURRENT_COLUMNS = `
  id, auth_user_id, arabic_first_name, arabic_family_name,
  hebrew_first_name, hebrew_family_name, phone_e164, phone_display,
  career_stage, seeking_work, retired
`;

interface CurrentRow {
  id: string;
  auth_user_id: string | null;
  arabic_first_name: string;
  arabic_family_name: string;
  hebrew_first_name: string | null;
  hebrew_family_name: string | null;
  phone_e164: string;
  phone_display: string | null;
  career_stage: "resident" | "specialist" | null;
  seeking_work: boolean;
  retired: boolean;
}

const fail = (f: SaveFailure) =>
  jsonError(f.status, { error: f.code, code: f.code, fields: f.fields });

/** GoTrue answers a taken number with a 422 rather than a SQLSTATE. */
const isTakenByAuth = (err: { status?: number; message?: string }) =>
  err.status === 422 || /already|exists|registered/i.test(err.message ?? "");

export const PATCH = withJsonErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const rl = await rateLimit("adminProfileSave", `admin:${admin.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return jsonError(404, { error: "not_found", code: "not_found" });

  let parsed: z.infer<typeof AdminProfileFieldsSchema>;
  try {
    parsed = AdminProfileFieldsSchema.parse(await req.json());
  } catch (e) {
    return jsonError(400, {
      error: "invalid_body",
      code: "invalid_body",
      fields: e instanceof z.ZodError ? zodFields(e) : undefined,
    });
  }

  const service = createSupabaseServiceClient();
  const found = await service.from("doctors").select(CURRENT_COLUMNS).eq("id", id).maybeSingle();
  if (found.error && found.error.code !== "PGRST116") {
    console.error("[admin.profile.patch] read failed", found.error);
    return jsonError(500, { error: "update_failed", code: "update_failed" });
  }
  if (!found.data) return jsonError(404, { error: "not_found", code: "not_found" });
  const current = found.data as unknown as CurrentRow;

  const ruleFailure = workplacesRuleFailure(parsed, current);
  if (ruleFailure) return fail(ruleFailure);

  let workplaceRows: Record<string, unknown>[] | null = null;
  if (parsed.workplaces) {
    const built = buildWorkplaceRows(parsed.workplaces);
    if ("error" in built) return fail(built.error);
    workplaceRows = built.rows;
  }

  const updates = buildProfileUpdates(parsed, current);

  // Hebrew names are stored normalized at signup; storing the raw text here
  // would leave two shapes of the same data in one column.
  const hebrew = (v: string | null | undefined) => (v ? normalizeHebrew(v) : null);
  if (parsed.hebrew_first_name !== undefined) updates.hebrew_first_name = hebrew(parsed.hebrew_first_name);
  if (parsed.hebrew_family_name !== undefined) updates.hebrew_family_name = hebrew(parsed.hebrew_family_name);
  const hebrewChanged =
    (parsed.hebrew_first_name !== undefined && updates.hebrew_first_name !== current.hebrew_first_name) ||
    (parsed.hebrew_family_name !== undefined && updates.hebrew_family_name !== current.hebrew_family_name);

  // is_phone_verified is only ever what the admin explicitly sends. Changing
  // the number does not clear it: nothing outside signup ever sets it back to
  // true, and false both delists the doctor (lib/directory.ts) and makes
  // login answer "unregistered", so an automatic clear would lock them out.
  if (parsed.is_phone_verified !== undefined) updates.is_phone_verified = parsed.is_phone_verified;

  let nextPhone: string | null = null;
  if (parsed.phone !== undefined) {
    try {
      nextPhone = normalizePhone(parsed.phone);
    } catch (e) {
      if (!(e instanceof InvalidPhoneError)) throw e;
      return jsonError(400, {
        error: "invalid_phone",
        code: "invalid_phone",
        fields: { phone: "صيغة رقم الهاتف غير صحيحة" },
      });
    }
    if (nextPhone === current.phone_e164) {
      // Same number, respelled: the display column is what the cards show,
      // so keep the admin's spelling even though no login has to move.
      const typed = parsed.phone.trim();
      if (typed !== current.phone_display) updates.phone_display = typed;
      nextPhone = null;
    } else {
      // OTP only reaches Israeli mobiles. A number that cannot receive one
      // locks the doctor out with no way back, so it takes a second, explicit
      // submit rather than a warning they might not read.
      if (!isSmsDeliverable(nextPhone) && !parsed.confirm_phone_risk) {
        return jsonError(409, {
          error: "phone_not_sms_deliverable",
          code: "phone_not_sms_deliverable",
          fields: {
            phone: "لن يصل رمز الدخول إلى هذا الرقم، ولن يستطيع الطبيب الدخول. أكّد إذا كنت متأكدًا.",
          },
        });
      }
      const held = await service
        .from("doctors")
        .select("arabic_first_name, arabic_family_name")
        .eq("phone_e164", nextPhone)
        .neq("id", id)
        .maybeSingle();
      if (held.data) {
        return jsonError(409, {
          error: "duplicate_phone",
          code: "duplicate_phone",
          fields: {
            phone: `الرقم مسجَّل مسبقًا لطبيب آخر (د. ${held.data.arabic_first_name} ${held.data.arabic_family_name}).`,
          },
        });
      }
      updates.phone_e164 = nextPhone;
      // The typed spelling is what the cards show, which is the point of the
      // column; fall back to a formatted form when the admin typed E.164.
      const typed = parsed.phone.trim();
      updates.phone_display = typed === nextPhone ? formatPhoneDisplay(nextPhone) : typed;
    }
  }

  const warnings: string[] = [];
  let authSync: "unchanged" | "updated" | "no_login_account" | "rolled_back" = "unchanged";

  // auth.users first. The likely collision is an orphan auth user from an
  // abandoned signup (verifyOtp creates it before the doctors row exists),
  // which no check against `doctors` can see — better to hit it before any
  // write than after.
  if (nextPhone && current.auth_user_id) {
    const moved = await service.auth.admin.updateUserById(current.auth_user_id, {
      phone: nextPhone,
      // Without this the number stays unconfirmed and OTP login refuses it.
      phone_confirm: true,
    });
    if (moved.error) {
      const taken = isTakenByAuth(moved.error);
      if (!taken) console.error("[admin.profile.patch] auth phone update failed", moved.error);
      return jsonError(taken ? 409 : 502, {
        error: taken ? "duplicate_phone" : "auth_update_failed",
        code: taken ? "duplicate_phone" : "auth_update_failed",
        fields: taken ? { phone: "الرقم مسجَّل مسبقًا في حساب دخول آخر." } : undefined,
      });
    }
    authSync = "updated";
  } else if (nextPhone) {
    authSync = "no_login_account";
    warnings.push("no_login_account");
  }

  const { failure, duplicate } = await saveProfileTransaction(
    service,
    id,
    { updates, specialtyIds: parsed.specialty_ids ?? null, workplaceRows },
    "admin.profile.patch",
  );

  if (failure) {
    // Put the login identity back where the doctors row still points. If even
    // that fails the two stores disagree and a person has to fix it.
    if (authSync === "updated" && current.auth_user_id) {
      const back = await service.auth.admin.updateUserById(current.auth_user_id, {
        phone: current.phone_e164,
        phone_confirm: true,
      });
      if (back.error) {
        console.error("[admin.profile.patch] auth phone rollback failed", back.error);
        Sentry.captureException(back.error, { extra: { doctor_id: id, action: "auth_phone_rollback" } });
      }
    }
    if (duplicate) {
      return jsonError(409, {
        error: "duplicate_phone",
        code: "duplicate_phone",
        fields: { phone: "الرقم مسجَّل مسبقًا لطبيب آخر." },
      });
    }
    return jsonError(failure.status, { error: failure.code, code: failure.code });
  }

  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "admin_doctor_profile_edited",
    target_doctor_id: id,
    metadata: {
      // Field names, not values: the log says what was touched without
      // becoming a second copy of the profile.
      fields: Object.keys(updates),
      ...(workplaceRows ? { workplaces: workplaceRows.length } : {}),
      ...(parsed.specialty_ids ? { specialties: parsed.specialty_ids.length } : {}),
      ...(hebrewChanged ? { hebrew_name_changed: true } : {}),
      ...(nextPhone
        ? {
            phone_changed: true,
            phone_before: maskPhone(current.phone_e164),
            phone_after: maskPhone(nextPhone),
            ...(isSmsDeliverable(nextPhone) ? {} : { phone_not_sms_deliverable: true }),
            auth_sync: authSync,
          }
        : {}),
    },
  });

  directoryChanged();
  return jsonOk({
    ok: true,
    warnings,
    // The licence narrative is recomputed from the Hebrew name on every
    // render, but the stored verdict is not: that is the admin's to redo.
    hebrew_name_changed: hebrewChanged,
  });
});
