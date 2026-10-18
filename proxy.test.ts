import { describe, expect, it } from "vitest";
import { isPublic } from "./proxy";

describe("isPublic", () => {
  it.each([
    "/",
    "/login",
    "/signup",
    "/verify",
    "/privacy",
    "/health",
    "/api/search",
    "/_next/data/x",
    "/favicon.ico",
    "/robots.txt",
  ])("%s is public", (p) => expect(isPublic(p)).toBe(true));

  it.each(["/dashboard", "/profile", "/admin", "/admin/audit", "/anything"])(
    "%s needs a session",
    (p) => expect(isPublic(p)).toBe(false),
  );
});
