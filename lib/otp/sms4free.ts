import { PhoneNotSmsDeliverableError, toSmsRecipient } from "@/lib/normalize/phone";
import { buildOtpMessage } from "./message";
import {
  type OtpSendResult,
  type OtpSender,
  OtpProviderError,
} from "./provider";

const DEFAULT_API_URL = "https://api.sms4free.co.il/ApiSMS/v2/SendSMS";
const DEFAULT_BALANCE_URL = "https://api.sms4free.co.il/ApiSMS/AvailableSMS";

// Supabase's Send SMS Hook gives us a 5s budget before it times out and
// retries. Bail at 4s so we return a real status code instead of being cut off.
const SEND_TIMEOUT_MS = 4_000;

// The balance check runs from cron, not from the hook, so it is not competing
// with a doctor waiting on a login screen.
const BALANCE_TIMEOUT_MS = 8_000;

/** Sender IDs are limited to 11 Latin alphanumeric characters by the provider. */
const SENDER_PATTERN = /^[A-Za-z0-9]{1,11}$/;

/**
 * Documented `status` values. Anything `> 0` is the number of recipients the
 * provider accepted; everything else is a failure.
 *
 * `permanent: true` means a Supabase retry cannot help, so the hook answers
 * 400 and Supabase drops it instead of burning its 3x/2s backoff. Every
 * negative code here is a configuration or account problem, not a hiccup.
 */
export const SMS4FREE_STATUS: Record<
  number,
  { label: string; permanent: boolean }
> = {
  // "General error — contact customer service." Ambiguous by definition, and
  // the contract says nothing was sent, so a bounded retry is safe and is the
  // only code here that could plausibly be transient.
  0: { label: "general provider error", permanent: false },
  [-1]: { label: "invalid key, user or password", permanent: true },
  [-2]: { label: "invalid sender id (requires a purchased package)", permanent: true },
  [-3]: { label: "no recipients", permanent: true },
  [-4]: { label: "insufficient message balance", permanent: true },
  [-5]: { label: "message content rejected", permanent: true },
  [-6]: { label: "sender number not verified", permanent: true },
};

interface Sms4FreeCredentials {
  key: string;
  user: string;
  pass: string;
  sender: string;
}

/**
 * Build the request body.
 *
 * Exported for unit testing without a network call — but note it carries the
 * account password, so it must never be logged or attached to a Sentry event.
 */
export function buildSendPayload(
  credentials: Sms4FreeCredentials,
  recipient: string,
  msg: string,
) {
  return {
    key: credentials.key,
    user: credentials.user,
    pass: credentials.pass,
    sender: credentials.sender,
    // The API takes a `;`-separated list. We always send exactly one number:
    // an OTP fanning out to a second recipient would be a security incident.
    recipient,
    msg,
  };
}

/**
 * Read the `{ status, message }` response.
 *
 * The documented shape is a JSON object, but the provider's own sample code
 * just prints the raw body, and v2 has been observed returning a bare number.
 * Accept both rather than treating a successful send as a parse failure.
 * Returns null when the body is neither — see the caller for why that is
 * deliberately not treated as a failed send.
 */
function bareInteger(trimmed: string): number | null {
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
}

export function parseSendResponse(
  raw: string,
): { status: number; message?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const bare = bareInteger(trimmed);
  if (bare !== null) return { status: bare };

  try {
    const body = JSON.parse(trimmed) as { status?: unknown; message?: unknown };
    if (typeof body.status === "number") {
      return {
        status: body.status,
        message: typeof body.message === "string" ? body.message : undefined,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * SMS4FREE sender (https://api.sms4free.co.il/ApiSMS/v2/SendSMS).
 *
 * Required env vars:
 *   SMS4FREE_KEY     — personal API key from the account page
 *   SMS4FREE_USER    — the phone number the account is registered with
 *   SMS4FREE_PASS    — the account password
 *   SMS4FREE_SENDER  — displayed sender; must be the registered number until
 *                      an SMS package is purchased, and must be verified once
 *                      by hand from the website before the API will accept it
 * Optional:
 *   SMS4FREE_API_URL — endpoint override, for staging or a contract change
 */
export class Sms4FreeOtpSender implements OtpSender {
  readonly name = "sms4free";
  private readonly credentials: Sms4FreeCredentials;
  private readonly apiUrl: string;

  constructor() {
    const key = process.env.SMS4FREE_KEY;
    const user = process.env.SMS4FREE_USER;
    const pass = process.env.SMS4FREE_PASS;
    const sender = process.env.SMS4FREE_SENDER;
    if (!key || !user || !pass || !sender) {
      throw new OtpProviderError(
        "Sms4FreeOtpSender missing env: SMS4FREE_KEY / SMS4FREE_USER / SMS4FREE_PASS / SMS4FREE_SENDER",
        true,
      );
    }
    // Catch a Hebrew or Arabic sender name at boot rather than as a -2 on the
    // doctor's first login attempt.
    if (!SENDER_PATTERN.test(sender)) {
      throw new OtpProviderError(
        "SMS4FREE_SENDER must be 1-11 Latin letters or digits",
        true,
      );
    }
    this.credentials = { key, user, pass, sender };
    this.apiUrl = process.env.SMS4FREE_API_URL ?? DEFAULT_API_URL;
  }

  async send(phoneE164: string, code: string): Promise<OtpSendResult> {
    let recipient: string;
    try {
      recipient = toSmsRecipient(phoneE164);
    } catch (err) {
      if (err instanceof PhoneNotSmsDeliverableError) {
        // The auth routes reject these before Supabase ever issues a code;
        // reaching here means an out-of-scope number slipped through, and no
        // amount of retrying will make it deliverable.
        throw new OtpProviderError(
          `SMS4FREE cannot deliver to this number (${err.reason})`,
          true,
          err,
        );
      }
      throw err;
    }

    const payload = buildSendPayload(
      this.credentials,
      recipient,
      buildOtpMessage(code),
    );

    let res: Response;
    try {
      res = await fetch(this.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      // Network error or timeout. The request may have reached the provider
      // and been billed — we cannot know. Transient, but see the runbook:
      // this is the "unknown" case, not a confirmed failure.
      throw new OtpProviderError(
        "SMS4FREE send failed: network error or timeout",
        false,
        err,
      );
    }

    const raw = await res.text();

    if (!res.ok) {
      throw new OtpProviderError(
        `SMS4FREE send failed: HTTP ${res.status}`,
        res.status >= 400 && res.status < 500,
      );
    }

    // The provider answers HTTP 200 even when it rejects the message, so the
    // body is the real result. Treating 200 as success would silently swallow
    // an empty balance or an unverified sender.
    const parsed = parseSendResponse(raw);
    if (!parsed) {
      throw new OtpProviderError(
        "SMS4FREE send failed: unparseable response body",
        false,
      );
    }

    if (parsed.status > 0) {
      // v2 returns the count of accepted recipients, not a message id, so
      // there is no provider-side reference to correlate on. Log correlation
      // goes through the hook's `webhook-id` instead.
      return { messageRef: `sms4free:accepted:${parsed.status}` };
    }

    const known = SMS4FREE_STATUS[parsed.status];
    throw new OtpProviderError(
      `SMS4FREE send failed (status ${parsed.status}): ${
        known?.label ?? parsed.message ?? "unknown status"
      }`,
      // An undocumented status is not known to be permanent; let Supabase's
      // bounded retry have a chance rather than failing the doctor outright.
      known?.permanent ?? false,
    );
  }
}

/**
 * Read the account's remaining message balance.
 *
 * The endpoint takes only the credentials — no sender, no recipient — and
 * answers with a bare number (observed: HTTP 200, `10`), reusing the same
 * negative status codes as the send endpoint for credential failures.
 *
 * This exists because the account is prepaid: hitting zero is a total,
 * silent signup/login outage that presents to doctors as "nothing happens".
 * `/api/cron/sms-balance` polls it so we hear about it before they do.
 */
export async function fetchAvailableSms(): Promise<number> {
  const key = process.env.SMS4FREE_KEY;
  const user = process.env.SMS4FREE_USER;
  const pass = process.env.SMS4FREE_PASS;
  if (!key || !user || !pass) {
    throw new OtpProviderError(
      "fetchAvailableSms missing env: SMS4FREE_KEY / SMS4FREE_USER / SMS4FREE_PASS",
      true,
    );
  }

  const url = process.env.SMS4FREE_BALANCE_URL ?? DEFAULT_BALANCE_URL;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, user, pass }),
      signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OtpProviderError(
      "SMS4FREE balance check failed: network error or timeout",
      false,
      err,
    );
  }

  if (!res.ok) {
    throw new OtpProviderError(
      `SMS4FREE balance check failed: HTTP ${res.status}`,
      res.status >= 400 && res.status < 500,
    );
  }

  const parsed = parseSendResponse(await res.text());
  if (!parsed) {
    throw new OtpProviderError(
      "SMS4FREE balance check failed: unparseable response body",
      false,
    );
  }

  // A zero balance is a real, valid answer — only negatives are errors here.
  if (parsed.status < 0) {
    const known = SMS4FREE_STATUS[parsed.status];
    throw new OtpProviderError(
      `SMS4FREE balance check failed (status ${parsed.status}): ${
        known?.label ?? "unknown status"
      }`,
      known?.permanent ?? false,
    );
  }

  return parsed.status;
}
