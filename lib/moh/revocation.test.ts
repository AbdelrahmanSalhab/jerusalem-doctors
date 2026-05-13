import { describe, expect, it } from "vitest";
import { REVOKE_AFTER_MISSING_CYCLES, shouldRevoke } from "./revocation";

describe("shouldRevoke", () => {
  it("does not revoke under threshold", () => {
    expect(shouldRevoke(0)).toBe(false);
    expect(shouldRevoke(1)).toBe(false);
    // REVOKE_AFTER_MISSING_CYCLES - 1 (i.e. 2) is the explicit boundary case from
    // test plan Test 10: one below threshold must NOT revoke.
    expect(shouldRevoke(REVOKE_AFTER_MISSING_CYCLES - 1)).toBe(false);
  });
  it("revokes at and above threshold", () => {
    expect(shouldRevoke(REVOKE_AFTER_MISSING_CYCLES)).toBe(true);
    expect(shouldRevoke(REVOKE_AFTER_MISSING_CYCLES + 5)).toBe(true);
  });
});
