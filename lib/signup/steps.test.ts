import { describe, expect, it } from "vitest";
import { firstStepOf, stepOfField } from "./steps";

describe("signup steps", () => {
  it("places each field in its step", () => {
    expect(stepOfField("phone")).toBe(0);
    expect(stepOfField("secondary_license_number")).toBe(0);
    expect(stepOfField("hebrew_full_name")).toBe(1);
    expect(stepOfField("arabic_family_name")).toBe(1);
    expect(stepOfField("stage")).toBe(2);
    expect(stepOfField("workplace_0_name")).toBe(2);
    expect(stepOfField("workplaces.0.name")).toBe(2);
    expect(stepOfField("consent")).toBe(2);
  });

  it("sends a set of errors to the earliest step", () => {
    expect(firstStepOf(["consent", "license_number"])).toBe(0);
    expect(firstStepOf(["specialty_ids", "hebrew_full_name"])).toBe(1);
    expect(firstStepOf([])).toBeNull();
  });
});
