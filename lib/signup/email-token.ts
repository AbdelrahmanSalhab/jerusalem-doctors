// Stateless email-verification token. Carries (id, exp) in a base64url
// JSON payload and an HMAC-SHA256 signature over the payload.
//
// Format: `${base64url(payload_json)}.${base64url(hmac_sha256(payload_json, secret))}`
//
// We do not persist tokens. Replay is blocked by the verify endpoint, which
// only flips `email_verified_at` from null; a second click is a no-op.
//
// `ttlMs` upper-bound = 24h — long enough for an email that landed in spam
// to still work.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface IssueOptions {
  id: string;
  ttlMs: number;
}

export interface TokenPayload {
  id: string;
  exp: number; // unix ms
}

export type VerifyResult =
  | { ok: true; id: string }
  | { ok: false; reason: "malformed" | "invalid_signature" | "expired" };

function getSecret(): string {
  const s = process.env.SIGNUP_TOKEN_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SIGNUP_TOKEN_SECRET is required in production");
    }
    // Dev convenience — tokens still validate locally without the env set,
    // but they cannot cross between dev and prod.
    return "dev-only-do-not-use-in-prod";
  }
  return s;
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  // Pad to multiple of 4.
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}

function sign(payloadB64url: string): string {
  const mac = createHmac("sha256", getSecret()).update(payloadB64url).digest();
  return b64urlEncode(mac);
}

export function issueEmailToken(opts: IssueOptions): string {
  const payload: TokenPayload = {
    id: opts.id,
    exp: Date.now() + opts.ttlMs,
  };
  const json = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(Buffer.from(json, "utf8"));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyEmailToken(token: string): VerifyResult {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sig] = token.split(".", 2);
  if (!payloadB64 || !sig) return { ok: false, reason: "malformed" };

  const expected = sign(payloadB64);
  let aBuf: Buffer;
  let bBuf: Buffer;
  try {
    aBuf = b64urlDecode(sig);
    bBuf = b64urlDecode(expected);
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }
  if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
    return { ok: false, reason: "invalid_signature" };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !payload ||
    typeof payload.id !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (payload.exp < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, id: payload.id };
}
