// What must never reach Sentry: every seeded doctor's names (Arabic and
// Hebrew, full and on their own, raw and URL-encoded), phones, licences and
// emails. e2e/env.ts points the app's Sentry at the stub (e2e/stubs.mjs);
// e2e/ui/sentry-privacy.spec.ts and the global teardown read what it got.

import { STUB_URL } from "./env";
import { DOCTORS } from "./seed";

export const sentEnvelopes = async () => (await fetch(`${STUB_URL}/sentry/envelopes`)).text();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One pattern per personal value; digits only match as a whole number. */
function personalPatterns(): { label: string; re: RegExp }[] {
  const out: { label: string; re: RegExp }[] = [];
  const add = (label: string, value: string, whole = false) => {
    for (const v of new Set([value, encodeURIComponent(value)])) {
      out.push({ label, re: new RegExp(whole ? `(?<!\\d)${escape(v)}(?!\\d)` : escape(v)) });
    }
  };
  for (const d of DOCTORS) {
    for (const name of [`${d.first} ${d.family}`, d.first, d.family, `${d.hebrewFirst} ${d.hebrewFamily}`, d.hebrewFirst, d.hebrewFamily]) {
      add(`name of ${d.key}`, name);
    }
    add(`phone of ${d.key}`, d.phone, true);
    add(`phone of ${d.key}`, d.phone.replace("+972", "0"), true);
    add(`licence of ${d.key}`, d.license, true);
    if (d.email) add(`email of ${d.key}`, d.email);
  }
  return out;
}

/** The personal values found in `sent`, by what they are (never the value). */
export function personalDataIn(sent: string): string[] {
  return [...new Set(personalPatterns().filter((p) => p.re.test(sent)).map((p) => p.label))];
}
