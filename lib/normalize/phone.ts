import { parsePhoneNumberFromString } from "libphonenumber-js";

export class InvalidPhoneError extends Error {
  constructor(input: string, reason?: string) {
    super(
      reason
        ? `Invalid phone number "${input}": ${reason}`
        : `Invalid phone number "${input}"`,
    );
    this.name = "InvalidPhoneError";
  }
}

/**
 * Parse and normalize a phone number to E.164 format.
 *
 * Accepts plus-prefixed international, country-code-prefixed without plus,
 * Israeli local form (`05…`), and inputs with hyphens / spaces. Defaults to
 * country `IL` when no international prefix is present.
 *
 * Throws `InvalidPhoneError` on failure — never returns null. This is the
 * single source of truth for phone format across signup, login, search and
 * the WhatsApp click-to-chat link builder.
 */
export function normalizePhone(input: string, defaultCountry: "IL" = "IL"): string {
  if (!input || typeof input !== "string") {
    throw new InvalidPhoneError(String(input), "empty input");
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new InvalidPhoneError(input, "empty after trim");
  }

  // libphonenumber-js handles internal hyphens/spaces but is strict about
  // leading characters; pre-strip whitespace and ASCII separators that users
  // commonly type ("050-123-4567", "+972 50 123 4567").
  const cleaned = trimmed.replace(/[\s\-().]/g, "");

  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed) {
    throw new InvalidPhoneError(input, "could not parse");
  }
  if (!parsed.isValid()) {
    throw new InvalidPhoneError(input, "failed validation");
  }

  return parsed.number; // E.164, e.g. "+972501234567"
}

/**
 * Best-effort display formatting for the dashboard. Falls back to the E.164
 * form on failure so callers always get a string.
 */
export function formatPhoneDisplay(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed?.formatNational() ?? e164;
}

// ---------------------------------------------------------------------------
// SMS deliverability
// ---------------------------------------------------------------------------
// OTP delivery moved from WhatsApp (which reached any number over data) to
// SMS4FREE, an Israeli A2P SMS provider. Its API takes Israeli local numbers
// (`05XXXXXXXX`) and we have no confirmed coverage for +970, so OTP is
// restricted to Israeli mobiles for now.
//
// This is deliberately NOT enforced inside normalizePhone(): that function is
// also the source of truth for directory search, profile display and the
// wa.me click-to-chat links, where existing +970 doctor rows must keep
// working. Only the auth entry points — the places about to ask Supabase to
// send a code — call the guards below.

/** Israeli mobile in E.164: +972, then a national number of `5` + 8 digits. */
const IL_MOBILE_E164 = /^\+9725\d{8}$/;

export type SmsUndeliverableReason = "foreign_region" | "not_mobile";

export class PhoneNotSmsDeliverableError extends Error {
  constructor(
    public readonly e164: string,
    public readonly reason: SmsUndeliverableReason,
  ) {
    super(
      reason === "foreign_region"
        ? `Phone "${e164}" is outside the +972 SMS region`
        : `Phone "${e164}" is not an Israeli mobile number`,
    );
    this.name = "PhoneNotSmsDeliverableError";
  }
}

/** True when we can currently deliver an OTP to this number. */
export function isSmsDeliverable(e164: string): boolean {
  return IL_MOBILE_E164.test(e164);
}

/**
 * Throws `PhoneNotSmsDeliverableError` when the number is out of scope for
 * OTP delivery. The `reason` distinguishes "wrong country" from "landline"
 * so callers can show the doctor the message that actually helps.
 */
export function assertSmsDeliverable(e164: string): void {
  if (isSmsDeliverable(e164)) return;
  throw new PhoneNotSmsDeliverableError(
    e164,
    e164.startsWith("+972") ? "not_mobile" : "foreign_region",
  );
}

/**
 * Convert a stored E.164 number to the local form SMS4FREE expects:
 * `+972501234567` → `0501234567`. Validates first — a number we cannot
 * deliver to must never be silently reshaped into one that looks valid.
 */
export function toSmsRecipient(e164: string): string {
  assertSmsDeliverable(e164);
  return `0${e164.slice("+972".length)}`;
}
