// POST /api/admin/push: this device (a browser's push subscription) wants the
// admin's notifications; DELETE: it no longer does. Each is the switch in the
// admin panel, for the signed-in admin and the device they are on. What is
// sent to it is in lib/push.ts.

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors, zodFields } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/** What PushSubscription.toJSON() gives. The endpoint is the push service's
 *  address for this device (https), so anything else is not one. */
const Subscription = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
const Removal = z.object({ endpoint: z.string().min(1).max(2000) });

export const POST = withJsonErrors(async (req: Request) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const rl = await rateLimit("adminPush", `admin:${admin.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const parsed = Subscription.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, { error: "invalid_body", code: "invalid_body", fields: zodFields(parsed.error) });
  }

  // The same device signing in as another admin takes the row over.
  const { error } = await createSupabaseServiceClient()
    .from("push_subscriptions")
    .upsert(
      { doctor_id: admin.id, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth },
      { onConflict: "endpoint" },
    );
  if (error) throw error;
  return jsonOk({ ok: true });
});

export const DELETE = withJsonErrors(async (req: Request) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const rl = await rateLimit("adminPush", `admin:${admin.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const parsed = Removal.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, { error: "invalid_body", code: "invalid_body" });

  // Only their own: an endpoint is a secret of the device it belongs to, but
  // a row is never removed on another admin's word.
  const { error } = await createSupabaseServiceClient()
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint)
    .eq("doctor_id", admin.id);
  if (error) throw error;
  return jsonOk({ ok: true });
});
