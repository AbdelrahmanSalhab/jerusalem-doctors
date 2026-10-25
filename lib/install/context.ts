// Installing the directory to a phone's home screen: which instructions fit
// this browser, and when the invitation may show. Pure, so it is tested
// without a browser; components/install/ does the browser side.
//
// Only Chromium browsers can open a native install prompt (the
// `beforeinstallprompt` event). iPhones and iPads never can, in any browser:
// people add the site through Share, then «إضافة إلى الشاشة الرئيسية».
// Browsers inside other apps (WhatsApp, Instagram, Facebook, …) usually
// can't install at all. Detection from the user agent is imperfect, so the
// manual help stays reachable from the menu whatever this says.

export type InstallGuide =
  /** iPhone or iPad, Safari: Share (or the page menu) → Add to Home Screen. */
  | "ios-safari"
  /** iPhone or iPad, Chrome, Edge or Firefox: their own Share → Add to Home Screen. */
  | "ios-other"
  /** Android without a native prompt right now: the browser menu. */
  | "android"
  /** A browser inside another app: open the page in a real browser first. */
  | "in-app"
  /** A computer, or anything else. */
  | "other";

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|; wv\)/i;

/** The instructions that fit a user agent. `touchMac` is a touch-screen
 *  "Mac", which is how an iPad presents itself to websites. */
export function installGuideFor(userAgent: string, touchMac = false): InstallGuide {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (touchMac && /Macintosh/.test(userAgent));
  if (IN_APP.test(userAgent)) return "in-app";
  if (ios) return /CriOS|EdgiOS|FxiOS/.test(userAgent) ? "ios-other" : "ios-safari";
  if (/Android/.test(userAgent)) return "android";
  return "other";
}

// ---------------------------------------------------------------------------
// When the invitation may show
// ---------------------------------------------------------------------------

/** «لاحقًا» or closing the invitation keeps it away this long. */
export const SNOOZE_DAYS = 7;
const DAY_MS = 86_400_000;

export const INVITE_KEYS = {
  /** localStorage: until when the invitation stays away (epoch ms). */
  snoozedUntil: "install:snoozed-until",
  /** localStorage: «أضفته بالفعل», the doctor's word, not a checked install. */
  added: "install:added",
  /** sessionStorage: the invitation already showed in this browser session. */
  shown: "install:shown",
} as const;

/** The two storages, or null where the browser refuses them. */
export interface InviteStores {
  local: Pick<Storage, "getItem" | "setItem"> | null;
  session: Pick<Storage, "getItem" | "setItem"> | null;
}

const read = (s: InviteStores["local"], key: string): string | null => {
  try {
    return s?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const write = (s: InviteStores["local"], key: string, value: string) => {
  try {
    s?.setItem(key, value);
  } catch {
    // Storage refused (private mode, full, blocked): the invitation just
    // shows again later, which is harmless.
  }
};

/** Whether the invitation may show now, on this browser. */
export function inviteAllowed(stores: InviteStores, now = Date.now()): boolean {
  if (read(stores.local, INVITE_KEYS.added) === "1") return false;
  if (read(stores.session, INVITE_KEYS.shown) === "1") return false;
  const until = Number(read(stores.local, INVITE_KEYS.snoozedUntil));
  return !(until > now);
}

/** Once per browser session at most. */
export const markInviteShown = (stores: InviteStores) => write(stores.session, INVITE_KEYS.shown, "1");

/** «لاحقًا», or closing it. */
export const snoozeInvite = (stores: InviteStores, now = Date.now()) =>
  write(stores.local, INVITE_KEYS.snoozedUntil, String(now + SNOOZE_DAYS * DAY_MS));

/** «أضفته بالفعل». */
export const markAlreadyAdded = (stores: InviteStores) => write(stores.local, INVITE_KEYS.added, "1");
