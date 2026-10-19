import { describe, expect, it } from "vitest";
import { directoryVisibility, STATE_SWITCHES, switchState, type VisibilityFlags } from "./doctorState";

const listed: VisibilityFlags = {
  is_admin_approved: true,
  is_active: true,
  is_visible: true,
  is_phone_verified: true,
  consent_directory_use: true,
};

describe("the three switches", () => {
  it("gives each one a distinct label, so none can be mistaken for another", () => {
    const labels = STATE_SWITCHES.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("words every on and off state distinctly across all three", () => {
    const words = STATE_SWITCHES.flatMap((s) => [s.on, s.off]);
    expect(new Set(words).size).toBe(words.length);
  });

  it("explains what each switch does", () => {
    for (const s of STATE_SWITCHES) {
      expect(s.hint.length).toBeGreaterThan(10);
      expect(s.hint).toMatch(/[؀-ۿ]/);
    }
  });

  it("reads the switch state in words", () => {
    const approval = STATE_SWITCHES[0];
    expect(switchState(approval, true)).toBe("مقبول");
    expect(switchState(approval, false)).toBe("بانتظار القبول");
  });
});

describe("directoryVisibility", () => {
  it("says a fully listed doctor is in the directory", () => {
    const v = directoryVisibility(listed);
    expect(v.listed).toBe(true);
    expect(v.blockers).toEqual([]);
    expect(v.sentence).toBe("يظهر في الدليل الآن.");
  });

  it("names the one thing standing in the way", () => {
    expect(directoryVisibility({ ...listed, is_admin_approved: false }).blockers).toEqual(["لم تُقبل عضويته بعد"]);
    expect(directoryVisibility({ ...listed, is_active: false }).blockers).toEqual(["الحساب مغلق"]);
    expect(directoryVisibility({ ...listed, is_visible: false }).blockers).toEqual(["الظهور في الدليل مُخفى"]);
    expect(directoryVisibility({ ...listed, is_phone_verified: false }).blockers).toEqual(["رقم هاتفه غير مُوثّق"]);
  });

  // The two conditions that are not switches are why an admin could flip
  // everything they had and still not see the doctor appear.
  it("explains that consent is not the admin's to change", () => {
    const v = directoryVisibility({ ...listed, consent_directory_use: false });
    expect(v.listed).toBe(false);
    expect(v.blockers[0]).toContain("لا تستطيع الإدارة تغيير هذا");
  });

  it("lists every blocker, approval first and consent last", () => {
    const v = directoryVisibility({
      is_admin_approved: false,
      is_active: false,
      is_visible: false,
      is_phone_verified: false,
      consent_directory_use: false,
    });
    expect(v.blockers).toHaveLength(5);
    expect(v.blockers[0]).toBe("لم تُقبل عضويته بعد");
    expect(v.blockers[4]).toContain("لم يوافق");
    expect(v.sentence).toContain("السبب:");
  });
});
