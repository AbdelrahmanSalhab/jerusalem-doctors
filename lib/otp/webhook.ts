// Standard Webhooks signature verification for Supabase's Send SMS Hook.
//
// The hook endpoint is public (proxy.ts treats all of /api/ as public), so
// this signature IS the authentication. Spec: https://www.standardwebhooks.com
//
// Hand-rolled rather than pulling the `standardwebhooks` package, matching how
// lib/turnstile.ts talks to Cloudflare with a raw fetch and no SDK.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Reject timestamps further than this from now, in either direction. */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Supabase hands out the secret as `v1,whsec_<base64>`. Older/other tooling
 * may present it as `whsec_<base64>` or bare `<base64>`. Accept all three.
 */
export function parseHookSecret(secret: string): Buffer {
  let s = secret.trim();
  if (s.startsWith("v1,")) s = s.slice(3);
  if (s.startsWith("whsec_")) s = s.slice(6);
  return Buffer.from(s, "base64");
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch; a differing length is already
  // a public fact about the encoding, so short-circuiting here leaks nothing.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Standard Webhooks request.
 *
 * @param rawBody the exact request body bytes as text — NOT a re-serialized
 *   JSON object, which would almost never match byte-for-byte.
 * @param nowMs injectable clock for tests.
 */
export function verifySendSmsHook(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs / 1000 - ts) > TOLERANCE_SECONDS) return false;

  let key: Buffer;
  try {
    key = parseHookSecret(secret);
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  // The header may carry several space-delimited `v1,<sig>` entries during
  // key rotation. Any one matching is a pass.
  for (const entry of signatureHeader.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma === -1) continue;
    if (entry.slice(0, comma) !== "v1") continue;
    if (constantTimeEquals(entry.slice(comma + 1), expected)) return true;
  }
  return false;
}

/** Sign a payload the way Supabase would. Test helper, not used in prod code. */
export function signSendSmsHook(
  rawBody: string,
  id: string,
  timestampSeconds: number,
  secret: string,
): string {
  const sig = createHmac("sha256", parseHookSecret(secret))
    .update(`${id}.${timestampSeconds}.${rawBody}`)
    .digest("base64");
  return `v1,${sig}`;
}
