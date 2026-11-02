// What the notification switch shows in each state, in Arabic.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PushSwitchView, type PushState } from "./PushSwitch";

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
