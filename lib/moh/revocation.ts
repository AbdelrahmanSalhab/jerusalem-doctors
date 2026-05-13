// Pure predicate used by the cron route's revocation sweep and any future
// sweep-related code. Keeping the threshold constant lifted to a module
// makes it greppable and testable independently.

export const REVOKE_AFTER_MISSING_CYCLES = 3;

// Returns true when the doctor has missed more than REVOKE_AFTER_MISSING_CYCLES
// consecutive sync cycles. Using strict greater-than gives the doctor
// REVOKE_AFTER_MISSING_CYCLES full missed cycles before revocation (a true
// grace window), rather than revoking on the cycle that hits the threshold.
export function shouldRevoke(missingCount: number): boolean {
  return missingCount > REVOKE_AFTER_MISSING_CYCLES;
}
