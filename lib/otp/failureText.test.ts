import { describe, expect, it } from "vitest";
import { failureText } from "./failureText";

describe("failureText", () => {
  it("says what to do about an empty balance", () => {
    expect(failureText("sms4free_status_-4")).toContain("اشحنه");
  });
  it("names Supabase's own limit and any other Supabase refusal", () => {
    expect(failureText("supabase_over_sms_send_rate_limit")).toContain("Supabase");
    expect(failureText("supabase_hook_timeout")).toContain("hook_timeout");
  });
  it("keeps an unknown status and an unrecorded reason readable", () => {
    expect(failureText("sms4free_status_-9")).toContain("-9");
    expect(failureText("unknown")).toBe("سبب غير مسجّل");
  });
});
