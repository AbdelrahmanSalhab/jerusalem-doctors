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

interface Subscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends `message` to each subscription; returns how many the push service
 *  accepted. A subscription it says is gone (404, 410: the browser
 *  unsubscribed, or the app was removed) is deleted. */
async function deliver(
  service: SupabaseClient,
  keys: NonNullable<ReturnType<typeof vapid>>,
  rows: Subscription[],
  message: PushMessage,
): Promise<number> {
  const body = JSON.stringify(message);
  const gone: string[] = [];
  let accepted = 0;
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, {
          vapidDetails: keys,
          TTL: TTL_SECONDS,
          timeout: SEND_TIMEOUT_MS,
        });
        accepted += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(row.id);
        // Not the endpoint: it identifies a phone.
        else console.error("[push] send failed", status ?? (err as Error).message);
      }
    }),
  );
  if (gone.length > 0) await service.from("push_subscriptions").delete().in("id", gone);
  return accepted;
}

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
    if (data?.length) await deliver(service, keys, data, message);
  } catch (err) {
    console.error("[push] failed", (err as Error).message);
  }
}

/** The switch's «جرّب»: one notification to this admin's own devices, at
 *  once and unthrottled, so they can see it works. null when the keys are not
 *  set; otherwise how many devices there were and how many the push service
 *  accepted it for (the others are gone, and are deleted). */
export async function sendTestPush(service: SupabaseClient, doctorId: string): Promise<{ devices: number; sent: number } | null> {
  const keys = vapid();
  if (!keys) return null;
  const { data, error } = await service
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("doctor_id", doctorId);
  if (error) throw error;
  const rows = data ?? [];
  const sent = await deliver(service, keys, rows, { title: "الإشعارات تعمل على هذا الجهاز", url: "/admin", tag: "test" });
  return { devices: rows.length, sent };
}
