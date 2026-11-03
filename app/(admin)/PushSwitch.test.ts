// What the notification switch shows in each state, in Arabic.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PushSwitchView, testResultText, type PushState } from "./PushSwitch";

const html = (state: PushState, over: Partial<Parameters<typeof PushSwitchView>[0]> = {}) =>
  renderToStaticMarkup(PushSwitchView({ state, busy: false, message: null, onEnable: () => {}, onDisable: () => {}, onTest: () => {}, ...over }));

describe("PushSwitchView", () => {
  it("offers to turn them on, and says what they are for", () => {
    const out = html("off");
    expect(out).toContain("تفعيل الإشعارات");
    expect(out).toContain("بانتظار القبول");
    expect(out).not.toContain("إيقاف");
  });

  it("offers a test and turning off when they are on", () => {
    const out = html("on");
    expect(out).toContain("الإشعارات مفعّلة على هذا الجهاز");
    expect(out).toContain("جرّب");
    expect(out).toContain("إيقاف");
    expect(out).not.toContain("تفعيل الإشعارات</button>");
  });

  it("explains instead of offering a button when this device cannot", () => {
    for (const [state, words] of [["denied", "محظورة"], ["unsupported", "لا يدعم"], ["unsupported-ios", "الشاشة الرئيسية"]] as const) {
      const out = html(state);
      expect(out).toContain(words);
      expect(out).not.toContain("<button");
    }
  });

  it("shows the latest result in place of the explanation, and disables the buttons while busy", () => {
    const out = html("on", { message: "أُرسل إشعار تجريبي.", busy: true });
    expect(out).toContain("أُرسل إشعار تجريبي.");
    expect(out.match(/<button[^>]*disabled/g)).toHaveLength(2);
  });

  it("is a labelled region, so a screen reader can find it", () => {
    expect(html("off")).toContain('aria-label="إشعارات الإدارة"');
  });
});

describe("testResultText", () => {
  it("counts the devices it reached out of the ones registered, and says where to look if one stays silent", () => {
    expect(testResultText(2, 2)).toContain("2 من 2");
    expect(testResultText(2, 2)).toContain("فتحقق من إعدادات الإشعارات");
  });

  it("says a device that stopped receiving was removed, and asks to turn it on again", () => {
    const out = testResultText(1, 2);
    expect(out).toContain("1 من 2");
    const none = testResultText(0, 1);
    expect(none).toContain("أُزيلت");
    expect(none).not.toContain("فتحقق");
  });

  it("says when no device is registered at all, which is how a missing desktop shows up", () => {
    expect(testResultText(0, 0)).toContain("لا جهاز مسجّل");
  });
});

describe("the stop button", () => {
  it("sits apart from the test button, at the far end, so one tap does not mean the other", () => {
    const out = html("on");
    expect(out.indexOf("جرّب")).toBeLessThan(out.indexOf("إيقاف"));
    expect(out).toMatch(/ms-auto[^"]*"[^>]*>إيقاف/);
  });
});
