import { describe, expect, it } from "vitest";
import { apiErrorMessage, fieldErrorMessage } from "./apiError";

describe("apiErrorMessage", () => {
  it("translates a known code and falls back for anything else", () => {
    expect(apiErrorMessage("rate_limited")).toMatch(/عدد كبير/);
    expect(apiErrorMessage("no_such_code")).toBe("حدث خطأ. الرجاء المحاولة مجددًا.");
    expect(apiErrorMessage(undefined, "x")).toBe("x");
  });
});

describe("fieldErrorMessage", () => {
  it("names the field in Arabic, including nested paths", () => {
    expect(fieldErrorMessage({ "workplaces.0.name": "قصير جدًا" })).toBe("أماكن العمل: قصير جدًا");
    expect(fieldErrorMessage({ mystery: "m" })).toBe("m");
    expect(fieldErrorMessage(undefined)).toBeNull();
  });
});
