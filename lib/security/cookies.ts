import type { CookieOptions } from "@supabase/ssr";

/**
 * Supabase session cookies: never readable from page scripts (nothing in the
 * browser uses Supabase directly, so an injected script has nothing to gain
 * by reading them), and https-only wherever the site is served over https.
 * Vercel always is; the local e2e stack is plain http.
 */
export function hardenCookie(options: CookieOptions = {}): CookieOptions {
  return { ...options, httpOnly: true, secure: process.env.VERCEL === "1" || options.secure === true };
}
