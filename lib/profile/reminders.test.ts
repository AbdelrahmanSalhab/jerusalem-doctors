import { describe, expect, it } from "vitest";
import { profileGaps } from "./reminders";

const clinic = { name: "عيادة النور", workplace_type: "clinic" as const, address: null, phone: null };

describe("profileGaps", () => {
  it("names a clinic's missing address and phone, and a missing photo", () => {
    expect(profileGaps({ career_stage: "specialist", profile_picture_url: null, certificates: ["ACLS"] }, [clinic])).toEqual([
      "أضف العنوان والهاتف لعيادة «عيادة النور» ليتمكّن الزملاء من الوصول إليها والاتصال بها.",
      "أضف صورة شخصية ليتعرّف عليك الزملاء.",
    ]);
  });

  it("asks only for what is missing", () => {
    const gaps = profileGaps({ career_stage: null, profile_picture_url: "p.jpg", certificates: ["ACLS"] }, [
      { ...clinic, address: "القدس" },
    ]);
    expect(gaps).toEqual(["أضف الهاتف لعيادة «عيادة النور» ليتمكّن الزملاء من الوصول إليها والاتصال بها."]);
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
});

describe("profileGaps: services", () => {
  it("asks for services when none are listed", () => {
    expect(profileGaps({ career_stage: "resident", profile_picture_url: "p.jpg", certificates: [] }, [])).toEqual([
      "أضف الخدمات والإجراءات التي تقدّمها، ليجدك الزملاء حين يبحثون عنها.",
    ]);
  });
});
