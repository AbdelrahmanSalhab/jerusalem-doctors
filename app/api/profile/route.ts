// PATCH /api/profile, partial update of the signed-in doctor's row.
// Server-side whitelist of editable columns. Locked fields (phone, license,
// hebrew name, admin flags) are ignored even if sent. Workplaces are managed
// as a single replace-all set per request, simpler than diffing.
//
// Every rule here is shared with the admin's edit of the same profile; it
// lives in lib/profile/save.ts so the two can't drift apart.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors, zodFields } from "@/lib/api/respond";
import { requireDoctor } from "@/lib/auth/session";
import {
  buildProfileUpdates,
  buildWorkplaceRows,
  ProfileFieldsSchema,
  saveProfileTransaction,
  workplacesRuleFailure,
} from "@/lib/profile/save";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { directoryChanged } from "@/lib/cachedReads";

export const PATCH = withJsonErrors(async (req: Request) => {
  const me = await requireDoctorOrNull();
  if (!me) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const rl = await rateLimit("profilePatch", `doctor:${me.id}`);
  if (!rl.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  let parsed: z.infer<typeof ProfileFieldsSchema>;
  try {
    parsed = ProfileFieldsSchema.parse(await req.json());
  } catch (e) {
    return jsonError(400, {
      error: "invalid_body",
      code: "invalid_body",
      fields: e instanceof z.ZodError ? zodFields(e) : undefined,
    });
  }

  const ruleFailure = workplacesRuleFailure(parsed, me);
  if (ruleFailure) {
    return jsonError(ruleFailure.status, {
      error: ruleFailure.code,
      code: ruleFailure.code,
      fields: ruleFailure.fields,
    });
  }

  // Validate everything before writing anything.
  let workplaceRows: Record<string, unknown>[] | null = null;
  if (parsed.workplaces) {
    const built = buildWorkplaceRows(parsed.workplaces);
    if ("error" in built) {
      return jsonError(built.error.status, {
        error: built.error.code,
        code: built.error.code,
        fields: built.error.fields,
      });
    }
    workplaceRows = built.rows;
  }

  const service = createSupabaseServiceClient();
  const { failure } = await saveProfileTransaction(
    service,
    me.id,
    {
      updates: buildProfileUpdates(parsed, me),
      specialtyIds: parsed.specialty_ids ?? null,
      workplaceRows,
    },
    "profile.patch",
  );
  if (failure) {
    return jsonError(failure.status === 409 ? 500 : failure.status, {
      error: "update_failed",
      code: "update_failed",
    });
  }

  // A featured card, or "looking for work", shows the change at once.
  directoryChanged();
  return jsonOk({ ok: true });
});

async function requireDoctorOrNull() {
  try {
    return await requireDoctor();
  } catch {
    return null;
  }
}
