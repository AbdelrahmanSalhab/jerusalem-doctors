import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/test/fakeSupabase";
import { failureReason, recordSendFailure, recordStopped } from "./failure";
import * as sentOnce from "./sentOnce";
import { vi } from "vitest";

vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});
import { OtpProviderError } from "./provider";

describe("failureReason", () => {
  it("uses the provider's own label", () => {
    expect(failureReason(new OtpProviderError("x", true, undefined, "sms4free_status_-4"))).toBe("sms4free_status_-4");
  });
  it("labels a Supabase refusal by its code, and keeps nothing else", () => {
    expect(failureReason({ code: "over_sms_send_rate_limit", message: "for +972501234567" })).toBe(
      "supabase_over_sms_send_rate_limit",
    );
    expect(failureReason({ status: 429 })).toBe("supabase_http_429");
    expect(failureReason({ code: "has a number 0501234567" })).toBe("unknown");
    expect(failureReason(new Error("boom"))).toBe("unknown");
  });
});

describe("recordSendFailure", () => {
  const service = db.client as unknown as SupabaseClient;
  beforeEach(() => db.reset());

  it("counts a doctor's failure against the doctor, with the reason and no number", async () => {
    db.queue("doctors", { data: { id: "doc-1" } });
    db.queue("pending_signups", { data: null });
    await recordSendFailure(service, "daily_cap", { phoneE164: "+972501234567" });
    expect(db.argsOf("usage_events", "insert")).toEqual([
      [{ kind: "sms_failed", doctor_id: "doc-1", meta: { reason: "daily_cap" } }],
    ]);
  });

  it("counts a signup's failure against the signup", async () => {
    db.queue("doctors", { data: null });
    db.queue("pending_signups", { data: { id: "signup-1" } });
    await recordSendFailure(service, "sms4free_timeout", { phoneE164: "+972501234567" });
    expect(db.argsOf("usage_events", "insert")).toEqual([
      [{ kind: "sms_failed", doctor_id: null, meta: { reason: "sms4free_timeout", signup: "signup-1" } }],
    ]);
  });

  it("records the reason alone for a number nobody holds", async () => {
    db.queue("doctors", { data: null });
    db.queue("pending_signups", { data: null });
    await recordSendFailure(service, "unknown", { phoneE164: "+972501234567" });
    expect(db.argsOf("usage_events", "insert")).toEqual([[{ kind: "sms_failed", doctor_id: null, meta: { reason: "unknown" } }]]);
  });
});

describe("recordStopped", () => {
  beforeEach(() => db.reset());

  it("counts a stopped request once a minute per reason, so a flood is not a flood of writes", async () => {
    vi.spyOn(sentOnce, "claimOnce").mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await recordStopped("our_rate_limit");
    await recordStopped("our_rate_limit");
    expect(db.argsOf("usage_events", "insert")).toEqual([
      [{ kind: "sms_failed", doctor_id: null, meta: { reason: "our_rate_limit" } }],
    ]);
  });
});
