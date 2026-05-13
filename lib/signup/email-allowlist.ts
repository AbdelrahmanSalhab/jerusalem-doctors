// Allowlist of Jerusalem medical-institution email domains. Membership
// implies the institution implicitly attests to the doctor's identity by
// running their mail server. Subdomain matches are accepted (e.g.
// `nursing.hadassah.org.il` counts as `hadassah.org.il`) because hospital
// sub-units share the institutional mail boundary.
//
// TODO(maintainer): Confirm this seed list with the Jerusalem-doctors
// pilot cohort before launch. Add Augusta Victoria, St Joseph, and any
// other Jerusalem-area medical institutions whose doctors are expected
// to participate. Each entry must be a domain you trust to gate
// institutional identity.

export const JERUSALEM_INSTITUTION_DOMAINS: readonly string[] = [
  "hadassah.org.il",
  "al-maqassed.org",
  "augustavictoria.org",
  "stjoseph-jerusalem.com",
  "szmc.org.il",
] as const;

const NORMALIZED = new Set(
  JERUSALEM_INSTITUTION_DOMAINS.map((d) => d.toLowerCase()),
);

/**
 * Returns the lowercased domain part of an email, or null if the input is
 * not a syntactically plausible email. We do not validate beyond
 * "@ present, both sides non-empty" — Zod handles full RFC validation
 * upstream.
 */
export function extractDomain(email: string): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;
  return domain;
}

/**
 * True when the email belongs to an allowlisted Jerusalem medical
 * institution (or a subdomain thereof). Subdomain matching is by literal
 * suffix (`.${parent}`); we do not strip TLD eTLDs because that opens a
 * homoglyph and shared-second-level-domain hole.
 */
export function isInstitutionalEmail(email: string): boolean {
  const domain = extractDomain(email);
  if (!domain) return false;
  if (NORMALIZED.has(domain)) return true;
  for (const parent of NORMALIZED) {
    if (domain.endsWith(`.${parent}`)) return true;
  }
  return false;
}
