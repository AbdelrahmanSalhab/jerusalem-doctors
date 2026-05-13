// Pure predicate used by the cron route's revocation sweep and any future
// sweep-related code. Keeping the threshold constant lifted to a module
// makes it greppable and testable independently.

export const REVOKE_AFTER_MISSING_CYCLES = 3;

export function shouldRevoke(missingCount: number): boolean {
  return missingCount >= REVOKE_AFTER_MISSING_CYCLES;
}
