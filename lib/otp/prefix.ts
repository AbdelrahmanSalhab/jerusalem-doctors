// The first digits of a mobile number (052, 059 ...), kept with a text's
// events so /admin/stats can show whether the lost codes share a network.
// Three digits name a range, not a person; the number itself is never stored.
// Numbers can move between networks, so this is a hint, not the carrier.

export function numberPrefix(e164: string): string {
  const m = /^\+97[02](\d{2})/.exec(e164);
  return m ? `0${m[1]}` : "other";
}
