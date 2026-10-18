import { describe, expect, it } from "vitest";
import { profileGaps } from "./reminders";

const clinic = { name: "عيادة النور", workplace_type: "clinic" as const, address: null, phone: null };

describe("profileGaps", () => {
  it("names a clinic's missing address and phone, and a missing photo", () => {
    expect(profileGaps({ career_stage: "specialist", profile_picture_url: null }, [clinic])).toEqual([
      "أضف العنوان والهاتف لعيادة «عيادة النور» ليتمكّن الزملاء من الوصول إليها والاتصال بها.",
      "أضف صورة شخصية ليتعرّف عليك الزملاء.",
    ]);
  });

  it("asks only for what is missing", () => {
    const gaps = profileGaps({ career_stage: null, profile_picture_url: "p.jpg" }, [
      { ...clinic, address: "القدس" },
    ]);
    expect(gaps).toEqual(["أضف الهاتف لعيادة «عيادة النور» ليتمكّن الزملاء من الوصول إليها والاتصال بها."]);
  });

  it("asks nothing of a complete profile or of a resident's workplaces", () => {
    expect(
      profileGaps({ career_stage: "specialist", profile_picture_url: "p.jpg" }, [
        { ...clinic, address: "القدس", phone: "026271234" },
      ]),
    ).toEqual([]);
    expect(profileGaps({ career_stage: "resident", profile_picture_url: "p.jpg" }, [])).toEqual([]);
  });

  it("asks a non-resident with no workplace to add one", () => {
    expect(profileGaps({ career_stage: "specialist", profile_picture_url: "p.jpg" }, [])).toEqual([
      "أضف مكان عملك ليعرف الزملاء أين يجدونك.",
    ]);
  });
});
