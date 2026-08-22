import { describe, expect, it, beforeEach } from "vitest";
import { issueEmailToken, verifyEmailToken } from "./email-token";

const SECRET = "test-secret-not-real";
const ID_A = "00000000-0000-0000-0000-000000000001";
const ID_B = "00000000-0000-0000-0000-000000000002";

describe("email token", () => {
  beforeEach(() => {
    process.env.SIGNUP_TOKEN_SECRET = SECRET;
  });

  it("round-trips a doctor token", () => {
    const token = issueEmailToken({ id: ID_B, ttlMs: 60_000 });
    const r = verifyEmailToken(token);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.id).toBe(ID_B);
  });

  it("rejects a tampered payload", () => {
    const token = issueEmailToken({ id: ID_A, ttlMs: 60_000 });
    const [payload, sig] = token.split(".");
    const bad = `${payload}AA.${sig}`;
    const r = verifyEmailToken(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_signature");
  });

  it("rejects a tampered signature", () => {
    const token = issueEmailToken({ id: ID_A, ttlMs: 60_000 });
    const [payload, sig] = token.split(".");
    const flipped = sig.replace(/.$/, sig.slice(-1) === "A" ? "B" : "A");
    const r = verifyEmailToken(`${payload}.${flipped}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_signature");
  });

  it("rejects an expired token", () => {
    const token = issueEmailToken({ id: ID_A, ttlMs: -1 });
    const r = verifyEmailToken(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects a malformed token", () => {
    expect(verifyEmailToken("garbage")).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    expect(verifyEmailToken("")).toMatchObject({
      ok: false,
      reason: "malformed",
    });
  });

  it("throws on issue when the secret is missing in production", () => {
    delete process.env.SIGNUP_TOKEN_SECRET;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(() =>
      issueEmailToken({ id: ID_A, ttlMs: 60_000 }),
    ).toThrow(/SIGNUP_TOKEN_SECRET/);
    (process.env as Record<string, string>).NODE_ENV = "test";
  });
});
