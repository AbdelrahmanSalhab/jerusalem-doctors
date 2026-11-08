// The bar at the foot of a waiting doctor's panel: always something to tap while
// they wait, the question when it is asked, the message once they are in, and a
// failed save said where the admin is looking.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AcceptBar } from "./AcceptBar";
import type { Approval } from "./useApproval";
import type { SwitchDoctor } from "./StateSwitches";

const DOCTOR: SwitchDoctor = {
  id: "d1",
  phone_e164: "+972501112233",
  arabic_first_name: "ليلى",
  arabic_family_name: "الخطيب",
  license_verification_status: "verified",
  license_region: "IL",
  is_admin_approved: false,
  is_active: true,
  is_visible: true,
  is_phone_verified: true,
  consent_directory_use: true,
};

const APPROVAL: Approval = { asking: false, told: false, kind: "identity", start: vi.fn(), cancel: vi.fn(), confirm: vi.fn(async () => true) };

const bar = (over: Partial<Approval> = {}, doctor: Partial<SwitchDoctor> = {}, notice: { ok: boolean; text: string } | null = null) =>
  renderToStaticMarkup(createElement(AcceptBar, { doctor: { ...DOCTOR, ...doctor }, busy: false, approval: { ...APPROVAL, ...over }, notice }));

describe("AcceptBar", () => {
  it("offers the accept button while the doctor waits", () => {
    const html = bar();
    expect(html).toContain("بانتظار القبول");
    expect(html).toContain("قبول العضوية");
  });

  it("asks the question when it is asked", () => {
    expect(bar({ asking: true })).toContain("كيف تأكّدت من هويته");
  });

  it("offers the message to send once the page shows the doctor as accepted", () => {
    const html = bar({ told: true }, { is_admin_approved: true });
    expect(html).toContain("أرسل رسالة واتساب");
    expect(html).not.toContain("بانتظار القبول");
  });

  it("keeps the accept button while the page has not caught up, or the acceptance was taken back", () => {
    expect(bar({ told: true })).toContain("قبول العضوية");
  });

  it("says a failed save inside the bar", () => {
    const html = bar({}, {}, { ok: false, text: "تعذّر حفظ التغيير. حاول مجددًا." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("تعذّر حفظ التغيير");
  });

  it("is not there for a doctor who is in and has nothing to say", () => {
    expect(bar({}, { is_admin_approved: true })).toBe("");
  });
});
