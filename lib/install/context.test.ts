import { describe, expect, it } from "vitest";
import {
  INVITE_KEYS,
  installGuideFor,
  inviteAllowed,
  markAlreadyAdded,
  markInviteShown,
  SNOOZE_DAYS,
  snoozeInvite,
  type InviteStores,
} from "./context";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
  ipadAsMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

describe("installGuideFor", () => {
  it("tells Safari from the other iPhone browsers", () => {
    expect(installGuideFor(UA.iphoneSafari)).toBe("ios-safari");
    expect(installGuideFor(UA.iphoneChrome)).toBe("ios-other");
  });

  it("treats an iPad presenting itself as a Mac as an iPad, only when it has a touch screen", () => {
    expect(installGuideFor(UA.ipadAsMac, true)).toBe("ios-safari");
    expect(installGuideFor(UA.ipadAsMac, false)).toBe("other");
  });

  it("spots browsers inside other apps, before anything else", () => {
    expect(installGuideFor(UA.androidWebView)).toBe("in-app");
    expect(installGuideFor(UA.iphoneInstagram)).toBe("in-app");
    expect(installGuideFor(UA.iphoneFacebook)).toBe("in-app");
  });

  it("falls back to the Android menu, or to a computer", () => {
    expect(installGuideFor(UA.androidChrome)).toBe("android");
    expect(installGuideFor(UA.desktopChrome)).toBe("other");
  });
});

/** In-memory storages; `null` for one the browser refuses. */
function stores(local = new Map<string, string>(), session = new Map<string, string>()): InviteStores {
  const wrap = (m: Map<string, string>) => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  });
  return { local: wrap(local), session: wrap(session) };
}

describe("the invitation's timing", () => {
  const NOW = Date.parse("2026-10-25T10:00:00Z");
  const DAY = 86_400_000;

  it("shows at first, then not again in the same browser session", () => {
    const s = stores();
    expect(inviteAllowed(s, NOW)).toBe(true);
    markInviteShown(s);
    expect(inviteAllowed(s, NOW)).toBe(false);
    // A new session (same device, sessionStorage cleared) may show it again.
    expect(inviteAllowed({ ...s, session: stores().session }, NOW)).toBe(true);
  });

  it(`stays away ${SNOOZE_DAYS} days after «لاحقًا» or closing it`, () => {
    const local = new Map<string, string>();
    snoozeInvite(stores(local), NOW);
    expect(inviteAllowed(stores(local), NOW + (SNOOZE_DAYS - 1) * DAY)).toBe(false);
    expect(inviteAllowed(stores(local), NOW + SNOOZE_DAYS * DAY + 1)).toBe(true);
  });

  it("stays away for good after «أضفته بالفعل», on this browser only", () => {
    const local = new Map<string, string>();
    markAlreadyAdded(stores(local));
    expect(local.get(INVITE_KEYS.added)).toBe("1");
    expect(inviteAllowed(stores(local), NOW + 365 * DAY)).toBe(false);
    expect(inviteAllowed(stores(), NOW)).toBe(true);
  });

  it("still works when the browser refuses storage", () => {
    const refused: InviteStores = {
      local: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } },
      session: null,
    };
    expect(inviteAllowed(refused, NOW)).toBe(true);
    expect(() => snoozeInvite(refused, NOW)).not.toThrow();
    expect(() => markInviteShown(refused)).not.toThrow();
  });
});
