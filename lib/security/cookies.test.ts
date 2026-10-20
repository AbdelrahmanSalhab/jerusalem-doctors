import { afterEach, describe, expect, it, vi } from "vitest";
import { hardenCookie } from "./cookies";

describe("hardenCookie", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("hides the session from page scripts and keeps Supabase's other options", () => {
    expect(hardenCookie({ path: "/", sameSite: "lax", maxAge: 60, httpOnly: false })).toEqual({
      path: "/",
      sameSite: "lax",
      maxAge: 60,
      httpOnly: true,
      secure: false,
    });
  });

  it("is https-only on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(hardenCookie({}).secure).toBe(true);
  });
});
