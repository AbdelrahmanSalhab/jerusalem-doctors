import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/test/fakeSupabase";

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage, captureException: vi.fn() }));

const { sendPushToAdmins } = vi.hoisted(() => ({ sendPushToAdmins: vi.fn(async () => {}) }));
vi.mock("@/lib/push", () => ({ sendPushToAdmins }));

import { ALERTS, raiseAlert } from "./alerts";
import { auditDetail, auditFields } from "./auditText";

const service = db.client as unknown as SupabaseClient;
beforeEach(() => {
  db.reset();
  captureMessage.mockClear();
  sendPushToAdmins.mockClear();
});

describe("raiseAlert", () => {
  it("tells Sentry in the words its alert rules match, and logs it for admins", async () => {
    await raiseAlert(service, "sms_balance_low", { level: "error", extra: { balance: 0, threshold: 100 } });
    expect(captureMessage).toHaveBeenCalledWith("SMS4FREE balance low", { level: "error", extra: { balance: 0, threshold: 100 }, tags: undefined });
    expect(db.argsOf("audit_logs", "insert")).toEqual([
      [{ action: "alert", metadata: { alert: "sms_balance_low", level: "error", balance: 0, threshold: 100 } }],
    ]);
  });

  it("keeps names out of Sentry but in the activity log", async () => {
    await raiseAlert(service, "licenses_missing", { extra: { flagged: 1 }, logOnly: { names: ["إياس سلهب (200001)"] } });
    expect(captureMessage).toHaveBeenCalledWith(ALERTS.licenses_missing.sentry, expect.objectContaining({ extra: { flagged: 1 } }));
    expect(db.argsOf("audit_logs", "insert")).toEqual([
      [{ action: "alert", metadata: { alert: "licenses_missing", level: "warning", flagged: 1, names: ["إياس سلهب (200001)"] } }],
    ]);
  });

  it("uses the alert's own level unless told otherwise", async () => {
    await raiseAlert(service, "doctor_waiting");
    expect(captureMessage).toHaveBeenCalledWith(ALERTS.doctor_waiting.sentry, expect.objectContaining({ level: "info" }));
  });
});

describe("raiseAlert and the admins' phones", () => {
  it("pushes the alerts that need an admin, with the Arabic title, the page to open and a tag of its own", async () => {
    await raiseAlert(service, "doctor_waiting");
    expect(sendPushToAdmins).toHaveBeenCalledWith(service, { title: ALERTS.doctor_waiting.ar, url: "/admin?status=pending", tag: "doctor_waiting" }, { rotate: true });
    await raiseAlert(service, "sms_cap_reached");
    expect(sendPushToAdmins).toHaveBeenLastCalledWith(service, expect.objectContaining({ url: "/admin/stats", tag: "sms_cap_reached" }), { rotate: false });
  });

  it("pushes exactly the thirteen that call for action, none of the noisy ones", async () => {
    for (const code of Object.keys(ALERTS) as (keyof typeof ALERTS)[]) await raiseAlert(service, code);
    const pushed = sendPushToAdmins.mock.calls.map((c) => (c as unknown as [unknown, { tag: string }])[1].tag).sort();
    expect(pushed).toEqual(["db_size_high", "deletion_requested", "directory_heavy_use", "directory_setting_on", "doctor_renamed", "doctor_waiting", "doctor_waiting_long", "license_duplicate_attempt", "licenses_missing", "number_requested", "profile_reported", "sms_balance_low", "sms_cap_reached"]);
  });

  it("sends the two new ones to the page that deals with them", async () => {
    await raiseAlert(service, "number_requested");
    expect(sendPushToAdmins).toHaveBeenLastCalledWith(service, { title: ALERTS.number_requested.ar, url: "/admin/requests", tag: "number_requested" }, { rotate: false });
    await raiseAlert(service, "deletion_requested");
    expect(sendPushToAdmins).toHaveBeenLastCalledWith(service, { title: ALERTS.deletion_requested.ar, url: "/admin?status=suspended", tag: "deletion_requested" }, { rotate: false });
  });

  it("never carries details: the push has the title and link only", async () => {
    await raiseAlert(service, "licenses_missing", { extra: { flagged: 1 }, logOnly: { names: ["إياس سلهب (200001)"] } });
    expect(JSON.stringify(sendPushToAdmins.mock.calls)).not.toContain("200001");
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

  it("says what to do about it", () => {
    expect(auditFields(row, () => undefined)).toContainEqual({ label: "ما العمل", value: ALERTS.sms_cap_reached.todo });
  });

  it("names who it is about, then how many more", () => {
    const names = ["أ (1)", "ب (2)", "ج (3)", "د (4)", "هـ (5)"];
    expect(auditDetail({ action: "alert", metadata: { alert: "licenses_missing", level: "warning", flagged: 5, names } }, () => undefined)).toBe(
      "تحذير · تراخيص أطباء لم تعد في سجل وزارة الصحة · أ (1)، ب (2)، ج (3) و2 غيرها",
    );
  });

  it("names the number that matters", () => {
    expect(auditDetail({ action: "alert", metadata: { alert: "unknown_workplaces", level: "warning", count: 3 } }, () => undefined)).toBe(
      "تحذير · أماكن عمل غير موجودة في قائمة المستشفيات · 3",
    );
  });
});
