// Recording the install steps (#150): one beacon to /api/usage/install,
// which never delays the step and never fails it. Only for a signed-in
// doctor (the <html> mark the layout sets): a visitor's would be refused.

import { INSTALL_OFFER_ATTR, installGuideFor } from "@/lib/install/context";
import type { InstallKind } from "@/lib/usage";

export function trackInstall(kind: InstallKind, source?: "card" | "menu"): void {
  if (!document.documentElement.hasAttribute(INSTALL_OFFER_ATTR)) return;
  const guide = installGuideFor(navigator.userAgent, navigator.maxTouchPoints > 1);
  try {
    navigator.sendBeacon?.("/api/usage/install", JSON.stringify({ kind, guide, source }));
  } catch {
    // Counting is best-effort; the step itself already happened.
  }
}
