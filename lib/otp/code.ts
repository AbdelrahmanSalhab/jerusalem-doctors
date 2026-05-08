// 6-digit OTP code generation + bcrypt-hashed comparison.
//
// Used by the mock and (later) Meta WhatsApp Cloud API providers. Twilio
// Verify owns code lifecycle so it does not need this. Codes are stored
// hashed in `pending_signups.payload.otp_hash` so a DB leak doesn't reveal
// recent codes.

import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

const BCRYPT_ROUNDS = 10;

export function generateOtpCode(): string {
  const n = randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

export async function hashOtpCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export async function verifyOtpHash(
  code: string,
  hash: string,
): Promise<boolean> {
  if (!code || !hash) return false;
  try {
    return await bcrypt.compare(code, hash);
  } catch {
    return false;
  }
}
