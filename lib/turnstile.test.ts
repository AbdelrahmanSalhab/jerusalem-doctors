import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

const fetchMock = vi.fn();

describe("verifyTurnstile", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("bypasses in dev without a secret", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(await verifyTurnstile(undefined)).toEqual({ ok: true, bypassed: true });
  });

  it("fails closed in production without a secret", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await verifyTurnstile("t")).ok).toBe(false);
  });

  describe("with a secret", () => {
    beforeEach(() => vi.stubEnv("TURNSTILE_SECRET_KEY", "sk"));

    it("rejects a missing token without calling Cloudflare", async () => {
      expect(await verifyTurnstile(null)).toEqual({ ok: false, errors: ["missing-token"] });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("passes the token and IP to Cloudflare", async () => {
      fetchMock.mockResolvedValue(Response.json({ success: true }));
      expect(await verifyTurnstile("t", "1.2.3.4")).toEqual({ ok: true, errors: undefined });
      const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
      expect(Object.fromEntries(body)).toEqual({ secret: "sk", response: "t", remoteip: "1.2.3.4" });
    });

    it("reports Cloudflare's error codes", async () => {
      fetchMock.mockResolvedValue(Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] }));
      expect(await verifyTurnstile("t")).toEqual({ ok: false, errors: ["timeout-or-duplicate"] });
    });

    it("fails on an HTTP error", async () => {
      fetchMock.mockResolvedValue(new Response("", { status: 503 }));
      expect(await verifyTurnstile("t")).toEqual({ ok: false, errors: ["turnstile-http-503"] });
    });
  });
});
