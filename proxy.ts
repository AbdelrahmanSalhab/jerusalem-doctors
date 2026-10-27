// Runs before every page and API request:
//
// 1. Sets the Content-Security-Policy with a fresh nonce (lib/security/csp.ts).
//    Next reads the nonce back from the request header and stamps it on its
//    own scripts; the root layout stamps it on the theme boot script.
// 2. Refreshes the Supabase Auth session, with cookies scripts cannot read.
// 3. Sends a visitor without a session to /login, except on public paths.
//
// Public paths match exactly, or as a whole subtree ("/login/dev" is under
// "/login/", but "/loginx" is under nothing). Every page and route also checks
// access itself; this is the first layer, not the only one.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hardenCookie } from "@/lib/security/cookies";
import { buildCsp, newNonce } from "@/lib/security/csp";

const PUBLIC_EXACT = new Set([
  "/",
  "/login",
  "/signup",
  "/verify",
  "/privacy",
  // Reporting a profile: the doctor it impersonates may have no account.
  "/report",
  "/health",
  "/favicon.ico",
  "/robots.txt",
  // The home-screen app manifest; phones fetch it before anyone logs in.
  "/manifest.webmanifest",
  // The offline page and the worker that shows it (public/sw.js): fetched
  // whether or not anyone is signed in, and must never be the login page.
  "/sw.js",
  "/offline.html",
]);

const PUBLIC_TREES = ["/login/", "/api/", "/_next/"];

/** Paths that look like files (/llms.txt, /sitemap.xml, /x.json) and
 *  /.well-known/: answered with the file or "not found", never the login
 *  page, which crawlers and agents would otherwise read as the file (#172).
 *  No page has a dot in its path, and every file here is public. */
const FILE_LIKE = /\.[a-z0-9]+$/i;

export function isPublic(pathname: string): boolean {
  return (
    PUBLIC_EXACT.has(pathname) ||
    PUBLIC_TREES.some((p) => pathname.startsWith(p)) ||
    FILE_LIKE.test(pathname) ||
    pathname.startsWith("/.well-known/")
  );
}

export async function proxy(req: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    upgradeInsecure: req.nextUrl.protocol === "https:",
    dev: process.env.NODE_ENV === "development",
  });
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set({ name, value, ...hardenCookie(options) });
          }
        },
      },
    },
  );

  // getClaims verifies the JWT and refreshes an expired session, writing the
  // new cookies through setAll above.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims.sub);

  if (!isPublic(req.nextUrl.pathname) && !signedIn) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
