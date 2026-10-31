// POST /api/sms/delivery: SMS4FREE's delivery reports, counted against the
// doctor or the signup, never the number.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliveryKey, newMessageId } from "@/lib/otp/delivery";
import { db } from "@/test/fakeSupabase";

vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const SECRET = "v1,whsec_test";
function report(fields: Record<string, string>, key = deliveryKey(SECRET)): Request {
  return new Request(`https://example.test/api/sms/delivery?k=${key}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}
const post = async (r: Request) => (await import("./route")).POST(r);

describe("POST /api/sms/delivery", () => {
  beforeEach(() => {
    db.reset();
    vi.stubEnv("SEND_SMS_HOOK_SECRET", SECRET);
  });

  it("refuses a report without our key", async () => {
    expect((await post(report({ to: "0501234567", status: "1" }, "nope"))).status).toBe(401);
    expect(db.argsOf("usage_events", "insert")).toEqual([]);
  });

  it("counts a delivered text against the doctor, with its delay", async () => {
    db.queue("doctors", { data: { id: "doc-1" } });
    db.queue("pending_signups", { data: null });
    const msgId = newMessageId(Date.now() - 12_000);
    expect((await post(report({ to: "0501234567", status: "1", msgId }))).status).toBe(200);
    expect(db.argsOf("usage_events", "insert")).toEqual([
      [{ kind: "sms_delivered", doctor_id: "doc-1", meta: { delay_s: 12 } }],
    ]);
  });

  it("counts a signup's undelivered text against the signup", async () => {
    db.queue("doctors", { data: null });
    db.queue("pending_signups", { data: { id: "signup-1" } });
    await post(report({ to: "0501234567", status: "5", msgId: "theirs" }));
    expect(db.argsOf("usage_events", "insert")).toEqual([
      [{ kind: "sms_undelivered", doctor_id: null, meta: { signup: "signup-1" } }],
    ]);
  });

  it("counts a kosher number's voice call", async () => {
    db.queue("doctors", { data: { id: "doc-2" } });
    db.queue("pending_signups", { data: null });
    await post(report({ to: "0501234567", status: "6" }));
    expect(db.argsOf("usage_events", "insert")).toEqual([[{ kind: "sms_voice", doctor_id: "doc-2", meta: {} }]]);
  });

  it("answers but ignores a status it doesn't count", async () => {
    expect((await post(report({ to: "0501234567", status: "3" }))).status).toBe(200);
    expect(db.argsOf("usage_events", "insert")).toEqual([]);
  });

  it("counts a text once when SMS4FREE reports it again", async () => {
    const msgId = newMessageId(Date.now() - 5_000);
    for (let i = 0; i < 3; i++) {
      db.queue("doctors", { data: { id: "doc-1" } });
      db.queue("pending_signups", { data: null });
      expect((await post(report({ to: "0501234567", status: "1", msgId }))).status).toBe(200);
    }
    expect(db.argsOf("usage_events", "insert")).toHaveLength(1);
  });

  it("counts a different status of the same text separately", async () => {
    const msgId = newMessageId(Date.now() - 5_000);
    for (const status of ["5", "1"]) {
      db.queue("doctors", { data: { id: "doc-1" } });
      db.queue("pending_signups", { data: null });
      await post(report({ to: "0501234567", status, msgId }));
    }
    expect(db.argsOf("usage_events", "insert")).toHaveLength(2);
  });
});
