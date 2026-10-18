import { describe, expect, it } from "vitest";
import { STAGE_BY_KEY } from "@/lib/careerStage";
import { emptyWorkplace, type WorkplaceEntry } from "@/lib/workplace";
import { profileFormError } from "./validate";

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

  it("asks a specialist's clinic for its address and phone, opening the section", () => {
    expect(profileFormError({ ...ok, workplaces: [row({ workplace_type: "clinic" })] })).toEqual({
      message: "أدخل عنوان العيادة ورقم هاتفها.",
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
