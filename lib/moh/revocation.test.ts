import { describe, expect, it } from "vitest";
import { REVOKE_AFTER_MISSING_CYCLES, shouldRevoke } from "./revocation";

describe("shouldRevoke", () => {
  it("does not revoke under or at threshold", () => {
    expect(shouldRevoke(0)).toBe(false);
    expect(shouldRevoke(1)).toBe(false);
    // REVOKE_AFTER_MISSING_CYCLES - 1 (i.e. 2): well below threshold.
    expect(shouldRevoke(REVOKE_AFTER_MISSING_CYCLES - 1)).toBe(false);
    // At the threshold: still within grace window, not yet revoked.
    expect(shouldRevoke(REVOKE_AFTER_MISSING_CYCLES)).toBe(false);
  });
  it("revokes only when strictly above threshold", () => {
    // Revocation happens after more than REVOKE_AFTER_MISSING_CYCLES misses.
    expect(shouldRevoke(REVOKE_AFTER_MISSING_CYCLES + 1)).toBe(true);
    expect(shouldRevoke(REVOKE_AFTER_MISSING_CYCLES + 5)).toBe(true);
    expect(shouldRevoke(10)).toBe(true);
  });
});
