// POST /api/admin/push/test: the switch's «جرّب». One notification to the
// signed-in admin's own devices, to see it works before an alert needs it.

import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { sendTestPush } from "@/lib/push";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const POST = withJsonErrors(async () => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const rl = await rateLimit("adminPushTest", `admin:${admin.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const sent = await sendTestPush(createSupabaseServiceClient(), admin.id);
  if (sent === null) return jsonError(503, { error: "push_not_configured", code: "push_not_configured" });
  return jsonOk({ ok: true, sent });
});
