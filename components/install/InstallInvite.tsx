"use client";

// The small invitation on the dashboard, after sign-in, to keep the
// directory on the home screen. Phones and tablets only, never in the
// installed app, at most once a browser session, and kept away 7 days after
// «لاحقًا» or closing it, for good after «أضفته بالفعل» (lib/install).
// On Android it waits for Chrome's install event, so «تثبيت» really
// installs; on an iPhone, or inside another app, it offers the instructions.

import { useEffect, useState } from "react";
import { useInstall } from "@/components/install/InstallProvider";
import { inviteAllowed, markAlreadyAdded, markInviteShown, snoozeInvite, type InviteStores } from "@/lib/install/context";

function browserStores(): InviteStores {
  const get = (name: "localStorage" | "sessionStorage") => {
    try {
      return window[name];
    } catch {
      return null;
    }
  };
  return { local: get("localStorage"), session: get("sessionStorage") };
}

export function InstallInvite() {
  const install = useInstall();
  const [show, setShow] = useState(false);

  const offerable =
    Boolean(install?.ready) &&
    !install?.standalone &&
    !install?.installed &&
    (install?.canPrompt || install?.guide === "ios-safari" || install?.guide === "ios-other" || install?.guide === "in-app");

  useEffect(() => {
    if (!offerable || show) return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const stores = browserStores();
    if (!inviteAllowed(stores)) return;
    markInviteShown(stores);
    // Browser-only facts (storage, pointer): read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(true);
  }, [offerable, show]);

  if (!install || !show || install.standalone || install.installed) return null;

  const later = () => {
    snoozeInvite(browserStores());
    setShow(false);
  };
  // After the native prompt, whatever the answer, the card has done its job.
  const act = () => {
    if (install.canPrompt) setShow(false);
    install.install();
  };
  const added = () => {
    markAlreadyAdded(browserStores());
    setShow(false);
  };

  return (
    <section
      aria-label="أضف الدليل إلى هاتفك"
      className="relative flex flex-col gap-3 rounded-lg border border-info-line bg-info-bg p-4 pe-10 text-sm text-info"
    >
      <button
        type="button"
        onClick={later}
        aria-label="إغلاق"
        className="absolute end-2 top-2 flex h-8 w-8 items-center justify-center rounded-full hover:bg-foreground/10"
      >
        ✕
      </button>
      <p>
        <strong className="font-semibold">أبقِ دليل أطباء القدس على شاشتك الرئيسية.</strong> افتح الدليل بضغطة
        واحدة.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={act}
          disabled={install.prompting}
          className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-fg hover:opacity-90 disabled:opacity-50"
        >
          {install.canPrompt ? "تثبيت" : "طريقة الإضافة"}
        </button>
        <button type="button" onClick={later} className="rounded-md border border-current/30 px-4 py-2 hover:bg-foreground/5">
          لاحقًا
        </button>
        <button type="button" onClick={added} className="px-2 py-2 underline">
          أضفته بالفعل
        </button>
      </div>
    </section>
  );
}
