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
