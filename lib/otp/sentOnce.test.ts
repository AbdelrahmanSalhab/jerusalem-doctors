import { describe, expect, it } from "vitest";
import { sentKey } from "./sentOnce";

describe("sentKey", () => {
  it("is the same for the same phone and code, and holds neither", () => {
    const key = sentKey("+972501234567", "482913", "secret");
    expect(key).toBe(sentKey("+972501234567", "482913", "secret"));
    expect(key).not.toContain("482913");
    expect(key).not.toContain("501234567");
  });

  it("differs for another code, phone or secret", () => {
    const key = sentKey("+972501234567", "482913", "secret");
    expect(sentKey("+972501234567", "482914", "secret")).not.toBe(key);
    expect(sentKey("+972501234568", "482913", "secret")).not.toBe(key);
    expect(sentKey("+972501234567", "482913", "other")).not.toBe(key);
  });
});
