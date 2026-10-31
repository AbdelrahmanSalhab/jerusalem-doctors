import { describe, expect, it } from "vitest";
import { codeSummary, countBySignup, NO_CODES } from "./summary";

describe("the code step per signup", () => {
  it("counts each signup's events and ignores the rest", () => {
    const counts = countBySignup([
      { kind: "sms_delivered", meta: { signup: "a", delay_s: 4 } },
      { kind: "otp_refused", meta: { flow: "signup", signup: "a", attempt: 1 } },
      { kind: "otp_refused", meta: { flow: "signup", signup: "a", attempt: 2 } },
      { kind: "otp_resent", meta: { flow: "signup", signup: "a" } },
      { kind: "sms_undelivered", meta: { signup: "b" } },
      { kind: "sms_failed", meta: { signup: "b", reason: "daily_cap" } },
      { kind: "search", meta: { signup: "a" } },
      { kind: "otp_refused", meta: null },
    ]);
    expect(counts.get("a")).toEqual({ ...NO_CODES, delivered: 1, refused: 2, resent: 1 });
    expect(counts.get("b")).toEqual({ ...NO_CODES, undelivered: 1, failed: 1 });
  });

  it("says it in one line, and nothing when nothing is known", () => {
    expect(codeSummary({ ...NO_CODES, delivered: 2, refused: 3, resent: 1, locked: 1 })).toBe(
      "وصلت الرسالة: 2 · رمز مرفوض: 3 · رمز جديد: 1 · تجاوز عدد المحاولات",
    );
    expect(codeSummary(NO_CODES)).toBe("");
  });
});
