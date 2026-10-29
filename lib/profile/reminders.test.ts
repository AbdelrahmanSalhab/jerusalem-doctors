import { describe, expect, it } from "vitest";
import { gapsKey, profileGaps } from "./reminders";

const clinic = { name: "عيادة النور", workplace_type: "clinic" as const, address: null, phone: null };

describe("profileGaps", () => {
  it("names a clinic's missing address and phone, and a missing photo", () => {
    expect(profileGaps({ career_stage: "specialist", profile_picture_url: null, certificates: ["ACLS"] }, [clinic])).toEqual([
      "يمكنك إضافة العنوان والهاتف لعيادة «عيادة النور» ليتمكّن الزملاء من الوصول إليها.",
      "أضف صورة شخصية ليتعرّف عليك الزملاء.",
    ]);
  });

  it("asks only for what is missing", () => {
    const gaps = profileGaps({ career_stage: null, profile_picture_url: "p.jpg", certificates: ["ACLS"] }, [
      { ...clinic, address: "القدس" },
    ]);
    expect(gaps).toEqual(["يمكنك إضافة الهاتف لعيادة «عيادة النور» ليتمكّن الزملاء من الوصول إليها."]);
  });

  it("asks nothing of a complete profile or of a resident's workplaces", () => {
    expect(
      profileGaps({ career_stage: "specialist", profile_picture_url: "p.jpg", certificates: ["ACLS"] }, [
        { ...clinic, address: "القدس", phone: "026271234" },
      ]),
    ).toEqual([]);
    expect(profileGaps({ career_stage: "resident", profile_picture_url: "p.jpg", certificates: ["ACLS"] }, [])).toEqual([]);
  });

  it("asks a non-resident with no workplace to add one", () => {
    expect(profileGaps({ career_stage: "specialist", profile_picture_url: "p.jpg", certificates: ["ACLS"] }, [])).toEqual([
      "أضف مكان عملك ليعرف الزملاء أين يجدونك.",
    ]);
  });

  it("asks nothing about workplaces of a retired doctor", () => {
    // The nudge would never clear: they have no workplace to add.
    expect(
      profileGaps(
        { career_stage: "specialist", profile_picture_url: "p.jpg", certificates: ["ACLS"], retired: true },
        [],
      ),
    ).toEqual([]);
    expect(
      profileGaps(
        { career_stage: "specialist", profile_picture_url: "p.jpg", certificates: ["ACLS"], retired: true },
        [clinic],
      ),
    ).toEqual([]);
  });
});

describe("profileGaps: services", () => {
  it("asks for services when none are listed", () => {
    expect(profileGaps({ career_stage: "resident", profile_picture_url: "p.jpg", certificates: [] }, [])).toEqual([
      "أضف الخدمات والإجراءات التي تقدّمها، ليجدك الزملاء حين يبحثون عنها.",
    ]);
  });
});

describe("profileGaps: several clinics", () => {
  const done = { career_stage: "specialist" as const, profile_picture_url: "p.jpg", certificates: ["ACLS"] };

  it("asks once for all of them, not once each", () => {
    expect(profileGaps(done, [clinic, { ...clinic, name: "عيادة الأمل" }, { ...clinic, name: "عيادة الشفاء" }])).toEqual([
      "يمكنك إضافة العنوان والهاتف لعياداتك ليتمكّن الزملاء من الوصول إليها.",
    ]);
  });

  it("names only what some clinic still lacks", () => {
    const full = { ...clinic, address: "القدس", phone: "026271234" };
    expect(profileGaps(done, [full, { ...full, name: "عيادة الأمل", phone: null }, { ...full, name: "عيادة الشفاء", phone: null }])).toEqual([
      "يمكنك إضافة الهاتف لعياداتك ليتمكّن الزملاء من الوصول إليها.",
    ]);
  });
});

describe("gapsKey", () => {
  it("changes when a gap is added or removed, not otherwise", () => {
    const a = gapsKey(["x", "y"]);
    expect(gapsKey(["x", "y"])).toBe(a);
    expect(gapsKey(["x"])).not.toBe(a);
    expect(gapsKey(["x", "y", "z"])).not.toBe(a);
  });
});
