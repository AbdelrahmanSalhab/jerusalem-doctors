import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "./csp";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `) || d === name);

describe("buildCsp", () => {
  const csp = buildCsp({
    nonce: "abc123",
    supabaseUrl: "https://projref.supabase.co",
    sentryDsn: "https://key@o1.ingest.de.sentry.io/42",
    upgradeInsecure: true,
  });

  it("lets only nonced scripts run, and what they load", () => {
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' https://challenges.cloudflare.com");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "script-src")).not.toContain("unsafe-inline");
  });

  it("allows the photo, Turnstile and Sentry hosts and nothing else", () => {
    expect(directive(csp, "img-src")).toBe("img-src 'self' data: blob: https://projref.supabase.co");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://challenges.cloudflare.com https://o1.ingest.de.sentry.io");
    expect(directive(csp, "frame-src")).toBe("frame-src https://challenges.cloudflare.com");
  });

  it("keeps the framing and form protections", () => {
    for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "upgrade-insecure-requests"]) {
      expect(csp.split("; ")).toContain(d);
    }
  });

  it("drops hosts it cannot parse and the upgrade on plain http", () => {
    const local = buildCsp({ nonce: "n", supabaseUrl: "not a url", upgradeInsecure: false });
    expect(directive(local, "img-src")).toBe("img-src 'self' data: blob:");
    expect(directive(local, "connect-src")).toBe("connect-src 'self' https://challenges.cloudflare.com");
    expect(local).not.toContain("upgrade-insecure-requests");
  });
});

describe("newNonce", () => {
  it("is different every time", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce().length).toBeGreaterThan(20);
  });
});
