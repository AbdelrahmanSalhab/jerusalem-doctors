import { describe, expect, it } from "vitest";
import { emptyWorkplace } from "@/lib/workplace";
import {
  applyStage,
  buildStartBody,
  cleanLicense,
  cleanPhone,
  type FormState,
  INITIAL,
} from "./formState";

const GENERAL = "gen";

describe("cleanPhone", () => {
  it("converts Arabic-Indic digits and drops labels", () => {
    expect(cleanPhone("Phone: ٠٥٠-1234567")).toBe(" 050-1234567");
  });
});

describe("cleanLicense", () => {
  it("keeps only the first hyphen of an IL license", () => {
    expect(cleanLicense("IL", "1-18-9371x")).toBe("1-189371");
  });
  it("only strips request-breaking characters from a PS license", () => {
    expect(cleanLicense("PS", "AB-12,(3)")).toBe("AB-123");
  });
});

describe("applyStage", () => {
  const base: FormState = {
    ...INITIAL,
    specialty_ids: [GENERAL, "s1"],
    subspecialty: "hand",
    certificates: ["ACLS"],
    residency_start_year: "2020",
    workplaces: [emptyWorkplace(true)],
  };

  it("general attaches only الطب العام and gives an untouched row a clinic type", () => {
    const next = applyStage(base, "general", GENERAL);
    expect(next.specialty_ids).toEqual([GENERAL]);
    expect(next.subspecialty).toBe("");
    expect(next.certificates).toEqual(["ACLS"]);
    expect(next.residency_start_year).toBe("");
    expect(next.workplaces[0].workplace_type).toBe("clinic");
  });

  it("general with no الطب العام row leaves the specialties empty", () => {
    expect(applyStage(base, "general", null).specialty_ids).toEqual([]);
  });

  it("resident drops الطب العام and certificates, keeps the year", () => {
    const next = applyStage(base, "resident", GENERAL);
    expect(next.specialty_ids).toEqual(["s1"]);
    expect(next.subspecialty).toBe("hand");
    expect(next.certificates).toEqual([]);
    expect(next.residency_start_year).toBe("2020");
  });

  it("does not mutate the input", () => {
    applyStage(base, "general", GENERAL);
    expect(base.specialty_ids).toEqual([GENERAL, "s1"]);
  });
});

describe("buildStartBody", () => {
  it("maps the UI stage and drops a secondary license that was unticked", () => {
    const body = buildStartBody(
      {
        ...INITIAL,
        stage: "resident",
        residency_start_year: "2021",
        secondary_license_number: "999",
      },
      true,
      "tok",
    );
    expect(body).toMatchObject({
      stage: undefined,
      career_stage: "resident",
      residency_start_year: 2021,
      secondary_license_region: null,
      secondary_license_number: null,
      override_name_mismatch: true,
      turnstile_token: "tok",
      workplaces: [],
    });
  });

  it("sends a trimmed secondary license when ticked, and null stage as null", () => {
    const body = buildStartBody(
      { ...INITIAL, has_secondary_license: true, secondary_license_number: " 12 " },
      false,
      "",
    );
    expect(body.career_stage).toBeNull();
    expect(body.residency_start_year).toBeNull();
    expect(body.secondary_license_region).toBe("PS");
    expect(body.secondary_license_number).toBe("12");
  });
});
