import { describe, expect, it } from "vitest";
import { STAGE_BY_KEY } from "@/lib/careerStage";
import { emptyWorkplace, type WorkplaceEntry } from "@/lib/workplace";
import { clinicsMissingDetails, profileFormError } from "./validate";

const row = (over: Partial<WorkplaceEntry> = {}): WorkplaceEntry => ({
  ...emptyWorkplace(true),
  name: "مستشفى",
  ...over,
});

const ok = {
  stageOpt: STAGE_BY_KEY.specialist,
  workplaces: [row()],
  specialtyIds: ["s1"],
  residencyStartYear: "",
};

describe("profileFormError", () => {
  it("passes a complete profile", () => {
    expect(profileFormError(ok)).toBeNull();
  });

  it("needs a workplace unless the stage makes it optional", () => {
    expect(profileFormError({ ...ok, workplaces: [emptyWorkplace(true)] })?.message).toBe(
      "الرجاء إدخال مكان عمل واحد على الأقل.",
    );
    expect(
      profileFormError({
        ...ok,
        stageOpt: STAGE_BY_KEY.resident,
        workplaces: [emptyWorkplace(true)],
        residencyStartYear: "2020",
      }),
    ).toBeNull();
  });

  it("saves a specialist's clinic without its address and phone", () => {
    expect(profileFormError({ ...ok, workplaces: [row({ workplace_type: "clinic" })] })).toBeNull();
  });

  it("rejects a clinic phone that was typed but is invalid", () => {
    expect(profileFormError({ ...ok, workplaces: [row({ workplace_type: "clinic", phone: "12" })] })).toEqual({
      message: "رقم هاتف العيادة غير صالح.",
      openWorkplaces: true,
    });
  });

  it("needs exactly one primary workplace", () => {
    expect(
      profileFormError({ ...ok, workplaces: [row(), row({ name: "عيادة" })] })?.message,
    ).toBe("اختر مكان عمل رئيسي واحد فقط.");
  });

  it("needs a specialty", () => {
    expect(profileFormError({ ...ok, specialtyIds: [] })?.message).toBe(
      "اختر تخصصًا واحدًا على الأقل.",
    );
  });

  it("needs a resident's start year", () => {
    expect(profileFormError({ ...ok, stageOpt: STAGE_BY_KEY.resident })?.message).toBe(
      "أدخل سنة بداية التخصص.",
    );
  });
});

describe("clinicsMissingDetails", () => {
  it("names a specialist's clinics that lack an address or phone", () => {
    const clinic = row({ name: "عيادة النور", workplace_type: "clinic" });
    const done = row({ name: "عيادة الشفاء", workplace_type: "clinic", address: "القدس", phone: "02-6271234" });
    expect(clinicsMissingDetails(STAGE_BY_KEY.specialist, [clinic, done, row()])).toEqual(["عيادة النور"]);
  });

  it("asks nothing of a stage without clinic fields", () => {
    expect(clinicsMissingDetails(STAGE_BY_KEY.resident, [row({ workplace_type: "clinic" })])).toEqual([]);
    expect(clinicsMissingDetails(null, [row({ workplace_type: "clinic" })])).toEqual([]);
  });
});
