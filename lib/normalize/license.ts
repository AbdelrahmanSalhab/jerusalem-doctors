// License-number format validation, split by issuing region.
//
// IL numbers are numeric (Israeli MoH registry format). PS has no public
// registry to validate a format against (checked 2026-08-22), so we only
// apply a loose sanity bound and defer everything else to manual admin
// review.

export type LicenseRegion = "IL" | "PS";

export function isValidLicenseFormat(
  region: LicenseRegion,
  licenseNumber: string,
): boolean {
  return region === "IL"
    ? /^\d{1,12}$/.test(licenseNumber)
    : /^[\p{L}\p{N}/-]{1,20}$/u.test(licenseNumber);
}

export function licenseFormatErrorMessage(region: LicenseRegion): string {
  return region === "IL"
    ? "رقم الترخيص يجب أن يحتوي على أرقام فقط"
    : "رقم الترخيص غير صالح";
}
