// Carries the phone (and signup session id) from /login or /signup to /verify.
//
// These stay out of the URL on purpose — they are PII, and a query string
// leaks into browser history, server logs and Referer headers.
//
// sessionStorage stays the primary store so a reload of /verify still works,
// but it is not always available: Safari private mode, "block all cookies",
// embedded webviews and some privacy extensions make setItem *throw*. That
// throw used to land in the form's catch block and show a connection error on
// a login whose SMS had already gone out. The in-memory fallback survives the
// client-side navigation that actually follows, so the flow completes even
// with storage blocked; only a manual reload of /verify falls back to the
// existing "start again" bounce.

const memory = new Map<string, string>();

export const SS_PHONE = "verify:phone";
export const SS_SESSION = "verify:signup_session";

export function setHandoff(key: string, value: string): void {
  memory.set(key, value);
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked — the in-memory copy above is what /verify will read.
  }
}

export function getHandoff(key: string): string {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored !== null) return stored;
  } catch {
    // Storage blocked — fall through to memory.
  }
  return memory.get(key) ?? "";
}

export function clearHandoff(key: string): void {
  memory.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing stored to clear.
  }
}
