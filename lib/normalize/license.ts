// License-number format validation and canonicalisation, split by issuing
// region.
//
// IL numbers come from the MoH practitioners registry. The registry's own
// site (registries.health.gov.il) displays a license as
// `<profession code>-<serial>` — e.g. `1-189371`, where `1` is רפואה
// (medicine). The open-data mirror we sync (data.gov.il resource
// 9c64c522-…) is physicians-only and stores the bare serial, so a doctor who
// copies the number as printed types `1-189371` (or `1189371` once the
// hyphen is dropped) and finds nothing.
//
// Not every doctor sees the prefixed form, so both are accepted and reduced
// to the serial before anything is looked up, compared for uniqueness, or
// stored.
//
// PS has no public registry to validate a format against (checked
// 2026-08-22), so we only apply a loose sanity bound and defer everything
// else to manual admin review.

export type LicenseRegion = "IL" | "PS";

/** Profession code for רפואה (medicine). The registry publishes 30 codes —
 * 2 is dentistry, 3 pharmacy, 101/102 nursing — and only this one belongs to
 * a physician. */
export const IL_PHYSICIAN_PROFESSION_CODE = "1";

/** Serials in the registry top out at 6 digits (highest observed: 522407,
 * with current issuance around 208000). Anything longer cannot be a serial,
 * which is what makes the unseparated `1189371` form safe to split. */
const IL_MAX_SERIAL_DIGITS = 6;

const IL_SEPARATED = /^(\d{1,3})\s*[-/]\s*(\d{1,12})$/;
const IL_DIGITS = /^\d{1,12}$/;

export type IlLicenseParseFailure =
  | "empty"
  | "not_numeric"
  | "wrong_profession"
  | "too_long";

export type ParsedIlLicense =
  | {
      ok: true;
      /** Canonical registry serial: digits only, no leading zeros. */
      serial: string;
      /** True when the input carried a `1-` / `1` profession prefix. */
      hadProfessionPrefix: boolean;
    }
  | {
      ok: false;
      reason: IlLicenseParseFailure;
      /** Set on `wrong_profession` so the UI can name the profession. */
      professionCode?: string;
    };

/**
 * Reduce a user-typed IL license number to the registry serial.
 *
 * Accepted:
 *   "189371"    → 189371            (bare serial, no prefix)
 *   "1-189371"  → 189371            (registry display form)
 *   "1 / 189371"→ 189371            (tolerated separators)
 *   "1189371"   → 189371            (hyphen dropped; 7 digits can't be a
 *                                    serial, so the leading 1 is the prefix)
 *   "0189371"   → 189371            (leading zeros are padding)
 *
 * Rejected:
 *   "2-45678"   → wrong_profession  (dentistry)
 *   "2189371"   → wrong_profession
 *   "12345678"  → too_long          (no reading of this is a serial)
 *
 * Deliberately NOT handled here: an unseparated number of 6 digits or fewer
 * is returned as-is, even though a doctor with a 5-digit serial may have
 * typed `1` in front of it. That case is genuinely ambiguous — `145678` is
 * both a plausible prefix+serial and a real serial in its own right — and
 * can only be resolved by cross-checking the registry name. See
 * lib/moh/match.ts.
 */
export function parseIlLicense(raw: string): ParsedIlLicense {
  const input = raw.trim();
  if (!input) return { ok: false, reason: "empty" };

  const separated = input.match(IL_SEPARATED);
  if (separated) {
    const [, professionCode, rest] = separated;
    if (stripLeadingZeros(professionCode) !== IL_PHYSICIAN_PROFESSION_CODE) {
      return {
        ok: false,
        reason: "wrong_profession",
        professionCode: stripLeadingZeros(professionCode),
      };
    }
    return finishSerial(rest, true);
  }

  if (!IL_DIGITS.test(input)) return { ok: false, reason: "not_numeric" };

  const digits = stripLeadingZeros(input);
  if (digits.length <= IL_MAX_SERIAL_DIGITS) return finishSerial(digits, false);

  // Longer than a serial can be, so the leading digits are a profession
  // prefix. Only a single-digit `1` produces a serial that fits.
  const professionCode = digits.slice(0, digits.length - IL_MAX_SERIAL_DIGITS);
  if (professionCode !== IL_PHYSICIAN_PROFESSION_CODE) {
    return digits.length > IL_MAX_SERIAL_DIGITS + 1
      ? { ok: false, reason: "too_long" }
      : { ok: false, reason: "wrong_profession", professionCode };
  }
  return finishSerial(digits.slice(professionCode.length), true);
}

function finishSerial(rest: string, hadProfessionPrefix: boolean): ParsedIlLicense {
  const serial = stripLeadingZeros(rest);
  if (!serial || serial === "0") return { ok: false, reason: "empty" };
  if (serial.length > IL_MAX_SERIAL_DIGITS) return { ok: false, reason: "too_long" };
  return { ok: true, serial, hadProfessionPrefix };
}

function stripLeadingZeros(s: string): string {
  const stripped = s.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

/**
 * Canonical storage/lookup form of a license number, or null when the input
 * can't be read. IL collapses to the registry serial so that `1-189371`,
 * `1189371` and `189371` are the same license for uniqueness purposes. PS is
 * passed through trimmed — we have no registry to canonicalise against.
 */
export function canonicalLicenseNumber(
  region: LicenseRegion,
  licenseNumber: string,
): string | null {
  if (region === "PS") {
    const trimmed = licenseNumber.trim();
    return isValidLicenseFormat("PS", trimmed) ? trimmed : null;
  }
  const parsed = parseIlLicense(licenseNumber);
  return parsed.ok ? parsed.serial : null;
}

export function isValidLicenseFormat(
  region: LicenseRegion,
  licenseNumber: string,
): boolean {
  return region === "IL"
    ? parseIlLicense(licenseNumber).ok
    : /^[\p{L}\p{N}/-]{1,20}$/u.test(licenseNumber.trim());
}

export function licenseFormatErrorMessage(
  region: LicenseRegion,
  licenseNumber?: string,
): string {
  if (region === "PS") return "رقم الترخيص غير صالح";

  const parsed =
    licenseNumber === undefined ? null : parseIlLicense(licenseNumber);
  if (parsed && !parsed.ok) {
    switch (parsed.reason) {
      case "wrong_profession":
        return `الرقم ${parsed.professionCode}- يخصّ مهنة صحّية أخرى (غير الطب). أدخل رقم ترخيص الطبيب، ويبدأ بـ 1-`;
      case "too_long":
        return "رقم الترخيص طويل أكثر من اللازم. أدخله كما يظهر في سجل وزارة الصحة، مثل 1-189371";
      case "empty":
        return "أدخل رقم الترخيص";
      case "not_numeric":
        break;
    }
  }
  return "رقم الترخيص يجب أن يحتوي على أرقام فقط (مع إمكانية إضافة الشرطة، مثل 1-189371)";
}
