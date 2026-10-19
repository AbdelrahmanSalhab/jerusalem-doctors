import { describe, expect, it } from "vitest";
import { COLLEAGUES_GEN, countOf, daysAgoText, DOCTORS } from "./arabicCount";

describe("countOf", () => {
  it("follows Arabic number agreement", () => {
    expect(countOf(1, DOCTORS)).toBe("طبيب واحد");
    expect(countOf(2, DOCTORS)).toBe("طبيبان");
    expect(countOf(3, DOCTORS)).toBe("3 أطباء");
    expect(countOf(10, DOCTORS)).toBe("10 أطباء");
    expect(countOf(11, DOCTORS)).toBe("11 طبيبًا");
    expect(countOf(24, DOCTORS)).toBe("24 طبيبًا");
    expect(countOf(53, DOCTORS)).toBe("53 طبيبًا");
    expect(countOf(100, DOCTORS)).toBe("100 طبيب");
    expect(countOf(103, DOCTORS)).toBe("103 أطباء");
    expect(countOf(0, DOCTORS)).toBe("0 أطباء");
    expect(countOf(2, COLLEAGUES_GEN)).toBe("زميلين");
    expect(countOf(22, COLLEAGUES_GEN)).toBe("22 زميلًا");
  });
});

describe("daysAgoText", () => {
  it("reads naturally", () => {
    expect(daysAgoText(0)).toBe("اليوم");
    expect(daysAgoText(1)).toBe("منذ يوم");
    expect(daysAgoText(2)).toBe("منذ يومين");
    expect(daysAgoText(5)).toBe("منذ 5 أيام");
    expect(daysAgoText(12)).toBe("منذ 12 يومًا");
  });
});
