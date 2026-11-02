"use client";

// The admin panel's notification switch: this phone or browser gets a message
// when an alert needs an admin (lib/push.ts). One line at the top of every
// admin page, because the permission can only be asked on a tap, and it says
// why when this device cannot (an iPhone only after the app is on the Home
// Screen).

import { useCallback, useEffect, useState } from "react";

export type PushState = "off" | "on" | "denied" | "unsupported" | "unsupported-ios";

const BUTTON = "shrink-0 rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50";

const TEXT: Record<PushState, string> = {
  off: "إشعارات الإدارة: تصلك على هذا الجهاز عند وجود طبيب بانتظار القبول أو بلاغ أو عطل عاجل.",
  on: "الإشعارات مفعّلة على هذا الجهاز.",
  denied: "الإشعارات محظورة لهذا الموقع. فعّلها من إعدادات المتصفح ثم أعد تحميل الصفحة.",
  unsupported: "هذا المتصفح لا يدعم الإشعارات.",
  "unsupported-ios": "لتفعيل الإشعارات على الآيفون: أضف الدليل إلى الشاشة الرئيسية، ثم افتحه منها.",
};

/** What the switch shows for a state; the logic below only picks the state. */
export function PushSwitchView({
  state,
  busy,
  message,
  onEnable,
  onDisable,
  onTest,
}: {
  state: PushState;
  busy: boolean;
  message: string | null;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
}) {
  return (
    <div role="region" aria-label="إشعارات الإدارة" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface px-3 py-2 text-sm">
      <p className="min-w-0 flex-1 text-foreground/80">{message ?? TEXT[state]}</p>
      {state === "off" && (
        <button type="button" onClick={onEnable} disabled={busy} className={BUTTON}>
          تفعيل الإشعارات
        </button>
      )}
      {state === "on" && (
        <>
          <button type="button" onClick={onTest} disabled={busy} className={BUTTON}>
            جرّب
          </button>
          <button type="button" onClick={onDisable} disabled={busy} className={BUTTON}>
            إيقاف
          </button>
        </>
      )}
    </div>
  );
}

/** The base64url public key as the bytes pushManager.subscribe wants. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function send(method: "POST" | "DELETE", path: string, body?: unknown): Promise<Response> {
  return fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

export function PushSwitch({ publicKey }: { publicKey: string }) {
  // null until mounted: what this device supports is only known in the browser.
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const read = useCallback(async (): Promise<PushState> => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) ? "unsupported-ios" : "unsupported";
    }
    if (Notification.permission === "denied") return "denied";
    const registration = await navigator.serviceWorker.getRegistration("/");
    return (await registration?.pushManager.getSubscription()) ? "on" : "off";
  }, []);

  useEffect(() => {
    if (!publicKey) return;
    void read().then(setState).catch(() => setState("unsupported"));
  }, [publicKey, read]);

  // Off until the keys are set (the runbook says how), and until mounted.
  if (!publicKey || state === null) return null;

  const run = async (task: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await task());
    } catch {
      setMessage("تعذّر ذلك الآن. حاول مرة أخرى.");
    }
    setState(await read().catch(() => "unsupported" as const));
    setBusy(false);
  };

  const enable = () =>
    run(async () => {
      // The permission is asked here, on the tap, which is the only time a
      // browser (an iPhone's above all) lets a page ask.
      if ((await Notification.requestPermission()) !== "granted") return "لم تُمنح الصلاحية، فلن تصلك إشعارات.";
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const saved = await send("POST", "/api/admin/push", subscription.toJSON());
      if (!saved.ok) {
        // Not kept by the server, so not kept by the browser either.
        await subscription.unsubscribe();
        return "تعذّر تفعيل الإشعارات. حاول مرة أخرى.";
      }
      return null;
    });

  const disable = () =>
    run(async () => {
      const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
      if (subscription) {
        await send("DELETE", "/api/admin/push", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      return null;
    });

  const test = () =>
    run(async () => {
      const res = await send("POST", "/api/admin/push/test");
      if (!res.ok) return "تعذّر إرسال إشعار تجريبي.";
      const { sent } = (await res.json()) as { sent: number };
      return sent > 0 ? "أُرسل إشعار تجريبي. إن لم يظهر خلال لحظات فتحقق من إعدادات الإشعارات في الجهاز." : "لا جهاز مسجّل لحسابك.";
    });

  return <PushSwitchView state={state} busy={busy} message={message} onEnable={enable} onDisable={disable} onTest={test} />;
}
