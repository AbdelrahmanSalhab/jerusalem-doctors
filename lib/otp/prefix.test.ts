import { describe, expect, it } from "vitest";
import { numberPrefix } from "./prefix";

describe("numberPrefix", () => {
  it.each([
    ["+972521234567", "052"],
    ["+972591234567", "059"],
    ["+970561234567", "056"],
  ])("%s is %s", (e164, prefix) => {
    expect(numberPrefix(e164)).toBe(prefix);
  });

  it("keeps nothing of a number outside the two regions", () => {
    expect(numberPrefix("+15551234567")).toBe("other");
    expect(numberPrefix("")).toBe("other");
  });

  it("never returns more than the range", () => {
    expect(numberPrefix("+972521234567")).toHaveLength(3);
  });
});
