import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCronAuth } from "./cronAuth";

function req(authz?: string): Request {
  return new Request("https://example.test/api/cron/x", {
    headers: authz ? { authorization: authz } : {},
  });
}

describe("verifyCronAuth", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the right bearer secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(verifyCronAuth(req("Bearer s3cret"))).toBeNull();
  });

  it.each([undefined, "Bearer wrong!", "Bearer s3cre", "s3cret", "Bearer s3cretX"])(
    "rejects %s with 401",
    (h) => {
      vi.stubEnv("CRON_SECRET", "s3cret");
      expect(verifyCronAuth(req(h))?.status).toBe(401);
    },
  );

  it("fails closed in production when the secret is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(verifyCronAuth(req())?.status).toBe(500);
  });

  it("allows local runs without a secret outside production", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(verifyCronAuth(req())).toBeNull();
  });
});
