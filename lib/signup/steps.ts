// Signup runs in three steps over one form. Which step a field belongs to
// decides what "التالي" waits for, and where a server error sends the doctor
// back to.

export const SIGNUP_STEPS = ["الترخيص والتواصل", "الاسم", "عملك"] as const;

const STEP_OF: Record<string, number> = {
  phone: 0,
  license_region: 0,
  license_number: 0,
  secondary_license_region: 0,
  secondary_license_number: 0,
  email: 0,
  arabic_first_name: 1,
  arabic_family_name: 1,
  hebrew_first_name: 1,
  hebrew_family_name: 1,
  hebrew_full_name: 1,
};

/** The step holding a field (by its form key or input id); the rest of the
 *  form (stage, specialty, workplaces, consent) is the last step. */
export function stepOfField(key: string): number {
  return STEP_OF[key] ?? SIGNUP_STEPS.length - 1;
}

/** The earliest step among some fields, e.g. where to send a server error. */
export function firstStepOf(keys: readonly string[]): number | null {
  return keys.length ? Math.min(...keys.map(stepOfField)) : null;
}
