// Web Push to the admins: when the app raises an alert that needs one of them
// (lib/alerts.ts), each phone or browser that turned notifications on gets a
// short message, so a doctor waiting for approval is not found by chance.
//
// The message is the alert's Arabic title and a link, never a name, a number
// or a licence: it travels through Apple's, Google's or Mozilla's push
// service. Off unless the VAPID keys are set (the runbook says how); a push
// that fails never fails what raised it.

import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { claimOnce } from "@/lib/otp/sentOnce";

export interface PushMessage {
  title: string;
  /** A path in this app, opened when the notification is tapped. */
  url: string;
  /** A newer notification with the same tag replaces the older one. */
  tag: string;
}

/** One notification per tag in this many seconds: a burst of signups is one
 *  buzz, and the admin list shows all of them. */
export const PUSH_THROTTLE_SECONDS = 300;
/** A push service that hangs must not hold the request's function open. */
const SEND_TIMEOUT_MS = 5_000;
/** How long the push service keeps a message for a phone that is off. */
const TTL_SECONDS = 3_600;

function vapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/** Whether pushes can be sent at all (the keys are set). */
export const pushConfigured = () => vapid() !== null;

export async function sendPushToAdmins(service: SupabaseClient, message: PushMessage): Promise<void> {
  try {
    const keys = vapid();
    if (!keys) return;
    if (!(await claimOnce(`push:${message.tag}`, PUSH_THROTTLE_SECONDS))) return;

    // Only admins who still are: a demoted or closed account stops getting them.
    const { data, error } = await service
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, doctor:doctors!inner(is_admin, is_active)")
      .eq("doctor.is_admin", true)
      .eq("doctor.is_active", true);
    if (error) {
      console.error("[push] subscriptions not read", error.code ?? error.message);
      return;
    }
    if (!data?.length) return;

    const body = JSON.stringify(message);
    const gone: string[] = [];
    await Promise.all(
      data.map(async (row) => {
        try {
          await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, {
            vapidDetails: keys,
            TTL: TTL_SECONDS,
            timeout: SEND_TIMEOUT_MS,
          });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // 404 and 410: the browser unsubscribed or the app was removed.
          if (status === 404 || status === 410) gone.push(row.id);
          // Not the endpoint: it identifies a phone.
          else console.error("[push] send failed", status ?? (err as Error).message);
        }
      }),
    );
    if (gone.length > 0) await service.from("push_subscriptions").delete().in("id", gone);
  } catch (err) {
    console.error("[push] failed", (err as Error).message);
  }
}
