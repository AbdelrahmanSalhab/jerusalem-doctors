import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/test/fakeSupabase";

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage, captureException: vi.fn() }));

import { ALERTS, raiseAlert } from "./alerts";
import { auditDetail, auditFields } from "./auditText";

const service = db.client as unknown as SupabaseClient;
beforeEach(() => {
  db.reset();
  captureMessage.mockClear();
});

describe("raiseAlert", () => {
  it("tells Sentry in the words its alert rules match, and logs it for admins", async () => {
    await raiseAlert(service, "sms_balance_low", { level: "error", extra: { balance: 0, threshold: 100 } });
    expect(captureMessage).toHaveBeenCalledWith("SMS4FREE balance low", { level: "error", extra: { balance: 0, threshold: 100 }, tags: undefined });
    expect(db.argsOf("audit_logs", "insert")).toEqual([
      [{ action: "alert", metadata: { alert: "sms_balance_low", level: "error", balance: 0, threshold: 100 } }],
    ]);
  });

  it("uses the alert's own level unless told otherwise", async () => {
    await raiseAlert(service, "doctor_waiting");
    expect(captureMessage).toHaveBeenCalledWith(ALERTS.doctor_waiting.sentry, expect.objectContaining({ level: "info" }));
  });
});

describe("an alert in the activity log", () => {
  const row = { action: "alert", metadata: { alert: "sms_cap_reached", level: "error", limit: 200 } };

  it("reads in Arabic, most urgent first", () => {
    expect(auditDetail(row, () => undefined)).toBe("عاجل · بلغت الرسائل الحد اليومي: لا رموز تحقق حتى يتجدد");
    expect(auditFields(row, () => undefined)).toEqual(
      expect.arrayContaining([
        { label: "التنبيه", value: ALERTS.sms_cap_reached.ar },
        { label: "الأهمية", value: "عاجل" },
      ]),
    );
  });

  it("names the number that matters", () => {
    expect(auditDetail({ action: "alert", metadata: { alert: "unknown_workplaces", level: "warning", count: 3 } }, () => undefined)).toBe(
      "تحذير · أماكن عمل غير موجودة في قائمة المستشفيات · 3",
    );
  });
});
