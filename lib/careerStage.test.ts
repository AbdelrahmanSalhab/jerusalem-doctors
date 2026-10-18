import { describe, expect, it } from "vitest";
import {
  CAREER_STAGES,
  careerStageBadge,
  findGeneralSpecialtyId,
  isValidResidencyYear,
  RESIDENCY_YEAR_MIN,
  residencyYearMax,
  STAGE_BY_KEY,
  STAGE_OPTIONS,
  stageFromCareerStage,
  toArabicIndicDigits,
  workplaceForStage,
} from "./careerStage";
import { WORKPLACE_TYPES } from "./workplace";

describe("stageFromCareerStage", () => {
  it("reads NULL as طب عام", () => {
    expect(stageFromCareerStage(null)).toBe("general");
  });

  it("round-trips every stored stage", () => {
    for (const cs of CAREER_STAGES) {
      expect(STAGE_BY_KEY[stageFromCareerStage(cs)].careerStage).toBe(cs);
    }
  });

  it("maps طب عام back to NULL", () => {
    expect(STAGE_BY_KEY.general.careerStage).toBeNull();
  });
});

describe("toArabicIndicDigits", () => {
  it("converts a year digit for digit", () => {
    expect(toArabicIndicDigits(2022)).toBe("٢٠٢٢");
    expect(toArabicIndicDigits(1950)).toBe("١٩٥٠");
  });

  // The reason this isn't Intl: ar-EG would group a 4-digit year as ٢٬٠٢٢.
  it("never inserts a thousands separator", () => {
    expect(toArabicIndicDigits(2100)).not.toContain("٬");
  });
});

describe("careerStageBadge", () => {
  it("qualifies a resident with the year", () => {
    expect(careerStageBadge("resident", 2022)).toBe("طبيب مقيم · منذ ٢٠٢٢");
  });

  it("falls back to the bare label without a year", () => {
    expect(careerStageBadge("resident", null)).toBe("طبيب مقيم");
  });

  // A stale year on a doctor who was promoted must not leak into the badge.
  it("ignores the year for a specialist", () => {
    expect(careerStageBadge("specialist", 2022)).toBe("طبيب أخصائي");
  });
});

describe("isValidResidencyYear", () => {
  it("rejects empty, out-of-range and non-integer input", () => {
    expect(isValidResidencyYear("")).toBe(false);
    expect(isValidResidencyYear(null)).toBe(false);
    expect(isValidResidencyYear(RESIDENCY_YEAR_MIN - 1)).toBe(false);
    expect(isValidResidencyYear(residencyYearMax() + 1)).toBe(false);
    expect(isValidResidencyYear("20x2")).toBe(false);
  });

  it("accepts a plausible year as a string or a number", () => {
    expect(isValidResidencyYear(String(residencyYearMax()))).toBe(true);
    expect(isValidResidencyYear(RESIDENCY_YEAR_MIN)).toBe(true);
  });
});

describe("workplaceForStage", () => {
  const CLINIC = {
    workplace_type: "clinic" as const,
    details: "",
    address: "شارع صلاح الدين ١٢",
    hours: "الأحد-الخميس ٩-٥",
    phone: "02-6271234",
  };
  const BLANK = { details: "", address: "", hours: "", phone: "" };

  it("coerces a type the stage doesn't offer, dropping the clinic fields", () => {
    expect(
      workplaceForStage({ ...CLINIC, details: "قديم", is_primary: true }, "resident"),
    ).toEqual({ workplace_type: "hospital", ...BLANK, is_primary: true });
  });

  it("keeps a specialist's clinic fields", () => {
    expect(workplaceForStage(CLINIC, "specialist")).toBe(CLINIC);
  });

  // طب عام and مقيم both hide the clinic inputs, so nothing may survive there.
  it("drops clinic fields for stages that hide them", () => {
    for (const stage of ["general", "resident"] as const) {
      expect(workplaceForStage(CLINIC, stage)).toMatchObject(BLANK);
    }
  });

  it("drops clinic fields when a specialist switches the row to مستشفى", () => {
    expect(
      workplaceForStage({ ...CLINIC, workplace_type: "hospital" }, "specialist"),
    ).toMatchObject({ workplace_type: "hospital", ...BLANK });
  });

  it("leaves an already-legal workplace untouched", () => {
    const w = { workplace_type: "hmo" as const, ...BLANK };
    expect(workplaceForStage(w, "resident")).toBe(w);
  });
});

describe("STAGE_OPTIONS", () => {
  it("offers a non-empty, known set of workplace types per stage", () => {
    for (const o of STAGE_OPTIONS) {
      expect(o.workplaceTypes.length).toBeGreaterThan(0);
      for (const t of o.workplaceTypes) expect(WORKPLACE_TYPES).toContain(t);
      expect(o.workplaceTypes).toContain(o.defaultWorkplaceType);
    }
  });

  it("matches the decided defaults", () => {
    expect(STAGE_BY_KEY.general.defaultWorkplaceType).toBe("clinic");
    expect(STAGE_BY_KEY.resident.defaultWorkplaceType).toBe("hospital");
    expect(STAGE_BY_KEY.specialist.defaultWorkplaceType).toBe("hospital");
  });

  it("keeps عيادة away from residents and صندوق مرضى to residents", () => {
    expect(STAGE_BY_KEY.resident.workplaceTypes).not.toContain("clinic");
    for (const stage of ["general", "specialist"] as const) {
      expect(STAGE_BY_KEY[stage].workplaceTypes).not.toContain("hmo");
    }
  });

  it("asks for a residency year only from residents", () => {
    expect(
      STAGE_OPTIONS.filter((o) => o.requiresResidencyStartYear).map(
        (o) => o.stage,
      ),
    ).toEqual(["resident"]);
  });

  it("asks for clinic details only from specialists", () => {
    expect(
      STAGE_OPTIONS.filter((o) => o.showsClinicFields).map((o) => o.stage),
    ).toEqual(["specialist"]);
    expect(STAGE_BY_KEY.specialist.workplaceTypes).toContain("clinic");
  });

  // A resident rotates between departments and hospitals during training.
  it("makes the workplace optional only for residents", () => {
    expect(
      STAGE_OPTIONS.filter((o) => o.workplaceOptional).map((o) => o.stage),
    ).toEqual(["resident"]);
  });

  it("hides الطب العام from the two stages that have a picker", () => {
    for (const o of STAGE_OPTIONS) {
      expect(o.excludesGeneralSpecialty).toBe(o.showsSpecialtyPicker);
    }
  });
});

describe("findGeneralSpecialtyId", () => {
  const general = { id: "g", name_ar: "الطب العام", code: "general" };
  const other = { id: "o", name_ar: "طب الأطفال", code: null };

  it("prefers the stable code over the display name", () => {
    const renamed = { id: "g2", name_ar: "طب عام (منقول)", code: "general" };
    expect(findGeneralSpecialtyId([other, renamed])).toBe("g2");
  });

  it("falls back to the name before 0009 has been applied", () => {
    expect(
      findGeneralSpecialtyId([
        { id: "o", name_ar: "طب الأطفال" },
        { id: "g", name_ar: "الطب العام" },
      ]),
    ).toBe("g");
  });

  it("returns null when the row is absent — the caller must cope", () => {
    expect(findGeneralSpecialtyId([other])).toBeNull();
  });

  it("finds it by code among a normal catalog", () => {
    expect(findGeneralSpecialtyId([other, general])).toBe("g");
  });
});
