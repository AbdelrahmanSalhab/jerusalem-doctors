// Phone keyboards, autofill and paste can slip invisible characters (zero-width
// marks, bidi marks, no-break spaces) into an address that looks fine. Browsers
// and z.email() reject those, so strip them before validating.
export function cleanEmail(value: string): string {
  return value.replace(/[\s​-‏‪-‮⁠⁦-⁩﻿]/g, "");
}
