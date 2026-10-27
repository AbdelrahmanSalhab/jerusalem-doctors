import { describe, expect, it } from "vitest";
import { isPublic } from "./proxy";

describe("isPublic", () => {
  it.each([
    "/",
    "/login",
    "/signup",
    "/verify",
    "/privacy",
    "/report",
    "/health",
    "/api/search",
    "/_next/data/x",
    "/favicon.ico",
    "/robots.txt",
    "/manifest.webmanifest",
    "/sw.js",
    "/offline.html",
    // The team's password sign-in. Public here because nobody has a session
    // yet when they reach it; the route and page gate themselves on
    // DEV_LOGIN (see lib/auth/devLogin.ts).
    "/login/dev",
    "/api/login/password",
    // Files, existing or not: their content or "not found", never the login
    // page, which crawlers and agents read as the file (#172).
    "/llms.txt",
    "/sitemap.xml",
    "/robots.txt",
    "/.well-known/ai-catalog.json",
    "/nonexistent.php",
  ])("%s is public", (p) => expect(isPublic(p)).toBe(true));

  it.each([
    "/dashboard",
    "/profile",
    "/admin",
    "/admin/audit",
    "/anything",
    // Prefixes only count as whole path segments.
    "/loginx",
    "/signup-admin",
    "/privacy2",
    "/healthz",
    "/favicon-admin",
    // A dot only counts as the file's extension, at the end.
    "/admin.v2/doctors",
    "/.well-knownx",
  ])(
    "%s needs a session",
    (p) => expect(isPublic(p)).toBe(false),
  );
});
