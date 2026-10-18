import { describe, expect, it } from "vitest";
import { daysSince, pct } from "./adminStats";

describe("admin stats helpers", () => {
  it("pct rounds and survives an empty whole", () => {
    expect(pct(1, 3)).toBe("33%");
    expect(pct(2, 3)).toBe("67%");
    expect(pct(0, 0)).toBe("0%");
  });

  it("daysSince counts whole days", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(daysSince("2026-10-16T13:00:00Z", now)).toBe(2);
    expect(daysSince("2026-10-19T11:00:00Z", now)).toBe(0);
    expect(daysSince(null, now)).toBeNull();
  });
});
