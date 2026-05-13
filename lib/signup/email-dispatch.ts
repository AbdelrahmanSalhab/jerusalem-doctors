// Cross-cutting helper: build the verify URL, render the email, send it.
// Used by signup/verify (initial dispatch), signup/email-start (resend),
// and an admin "resend email" action.
//
// Idempotency: each call issues a unique Resend Idempotency-Key that includes
// Date.now(), so every dispatch attempt triggers a real send rather than being
// deduplicated by Resend's 24-hour idempotency window. This is intentional:
// "Resend email" requests must reliably produce a new message.

import { createHash } from "node:crypto";
import { ResendClient } from "@/lib/email/resend";
import { renderSignupVerifyEmail } from "@/lib/email/templates/signup-verify";
import { issueEmailToken } from "./email-token";

// 24h window: generous enough for emails that land in spam.
const DOCTOR_TTL_MS = 24 * 60 * 60_000;

export interface DispatchInput {
  /** The doctor row id whose email we are verifying. */
  doctorId: string;
  email: string;
  arabicFirstName: string;
  resend?: ResendClient;
}

export async function dispatchSignupVerifyEmail(input: DispatchInput): Promise<void> {
  const id = input.doctorId;

  const ttlMs = DOCTOR_TTL_MS;
  const token = issueEmailToken({ id, ttlMs });

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  const normalisedBase = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  const verifyUrl = `${normalisedBase}/api/signup/email-verify?token=${encodeURIComponent(token)}`;

  const { subject, html, text } = renderSignupVerifyEmail({
    arabicFirstName: input.arabicFirstName,
    verifyUrl,
    expiryHours: Math.floor(ttlMs / 3_600_000),
  });

  // Include a timestamp so each dispatch attempt has a unique key. A static
  // key (doctor+email only) would hit Resend's 24-hour idempotency window
  // and silently deduplicate "Resend email" requests, leaving the user with
  // no new email. A per-send timestamp makes every dispatch unique while
  // still allowing safe client-side retry if the connection drops mid-request.
  const idempotencyKey = createHash("sha256")
    .update(`doctor:${id}:${input.email}:${Date.now()}`)
    .digest("hex");

  const client = input.resend ?? new ResendClient();
  await client.send({
    to: input.email,
    subject,
    html,
    text,
    idempotencyKey,
  });
}
