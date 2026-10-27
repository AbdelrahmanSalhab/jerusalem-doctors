// The site's public address and what search engines and AI agents may read.
//
// Only the pages that explain the directory and let a doctor join are
// indexable; everything else is behind sign-in and says noindex (the root
// layout's default). Doctor data is never on an indexable page (#171).

import type { Metadata } from "next";

/** Vercel's production domain (a system variable, always set on Vercel);
 *  the current one elsewhere. */
export const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "https://jerusalem-doctors.vercel.app";

/** The pages search engines may index, with what each is for (llms.txt). */
export const PUBLIC_PAGES = [
  { path: "/", name: "Home", about: "what the directory is and how to join" },
  { path: "/signup", name: "Sign up", about: "the signup form, for doctors with a medical licence" },
  { path: "/privacy", name: "Privacy policy", about: "what is collected and who sees it" },
] as const;

/** A public page's metadata: indexable, under its canonical address. */
export function indexable(path: (typeof PUBLIC_PAGES)[number]["path"], extra: Metadata = {}): Metadata {
  return { ...extra, robots: { index: true, follow: true }, alternates: { canonical: path } };
}
