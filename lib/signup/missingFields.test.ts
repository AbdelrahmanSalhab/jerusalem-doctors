import { describe, expect, it } from "vitest";
import { getMissingFields, type SignupFields } from "./missingFields";

const WP = { name: "", workplace_type: "hospital" as const, address: "", phone: "" };

const EMPTY: SignupFields = {
  phone: "",
  license_region: "IL",
  license_number: "",
  has_secondary_license: false,
  secondary_license_region: "PS",
  secondary_license_number: "",
  arabic_first_name: "",
  arabic_family_name: "",
  hebrew_first_name: "",
  hebrew_family_name: "",
  stage: null,
  residency_start_year: "",
  specialty_ids: [],
  email: "",
  workplaces: [WP],
  consent: false,
};

const COMPLETE: SignupFields = {
  ...EMPTY,
  phone: "0501234567",
  license_number: "189371",
  arabic_first_name: "أحمد",
  arabic_family_name: "الخطيب",
  hebrew_first_name: "אחמד",
  hebrew_family_name: "אלחטיב",
  stage: "specialist",
  specialty_ids: ["s1"],
  email: "a@b.co",
  workplaces: [{ ...WP, name: "المقاصد" }],
  consent: true,
};

const keys = (f: SignupFields) => getMissingFields(f).map((m) => m.key);

describe("getMissingFields", () => {
  it("lists every required field on an empty IL form, in page order", () => {
    expect(keys(EMPTY)).toEqual([
      "phone",
      "license_number",
      "email",
      "arabic_first_name",
      "arabic_family_name",
      "hebrew_first_name",
      "hebrew_family_name",
      "stage",
      "consent",
    ]);
  });

  it("is empty for a complete form", () => {
    expect(getMissingFields(COMPLETE)).toEqual([]);
  });

  it("gives every entry an Arabic label", () => {
    for (const m of getMissingFields(EMPTY)) expect(m.label).toMatch(/\p{Script=Arabic}/u);
  });

  it("drops the Hebrew name for a PS-only doctor", () => {
    const f = { ...COMPLETE, license_region: "PS" as const, hebrew_first_name: "", hebrew_family_name: "" };
    expect(keys(f)).toEqual([]);
  });

  it("asks for the Hebrew name when only the secondary license is IL", () => {
    const f = {
      ...COMPLETE,
      license_region: "PS" as const,
      has_secondary_license: true,
      secondary_license_region: "IL" as const,
      secondary_license_number: "189371",
      hebrew_first_name: "",
      hebrew_family_name: "",
    };
    expect(keys(f)).toEqual(["hebrew_first_name", "hebrew_family_name"]);
  });

  it("asks for the secondary number once the box is ticked", () => {
    expect(keys({ ...COMPLETE, has_secondary_license: true })).toEqual([
      "secondary_license_number",
    ]);
  });

  it("asks a resident for a valid start year but not a workplace", () => {
    const f = { ...COMPLETE, stage: "resident" as const, workplaces: [WP] };
    expect(keys(f)).toEqual(["residency_start_year"]);
    expect(keys({ ...f, residency_start_year: "1800" })).toEqual(["residency_start_year"]);
    expect(keys({ ...f, residency_start_year: "2022" })).toEqual([]);
  });

  it("asks for a specialty and a workplace once a stage is picked", () => {
    const f = { ...COMPLETE, specialty_ids: [], workplaces: [WP] };
    expect(keys(f)).toEqual(["specialty_ids", "workplace_0_name"]);
  });

  it("asks a specialist for each named clinic's address and phone", () => {
    const clinic = { name: "عيادة النور", workplace_type: "clinic" as const, address: "", phone: "" };
    const f = { ...COMPLETE, workplaces: [{ ...WP, name: "المقاصد" }, clinic] };
    const missing = getMissingFields(f);
    expect(missing.map((m) => m.key)).toEqual(["workplace_1_address", "workplace_1_phone"]);
    expect(missing[0]!.label).toContain("عيادة النور");
  });

  it("does not ask a GP for clinic details", () => {
    const clinic = { name: "عيادة النور", workplace_type: "clinic" as const, address: "", phone: "" };
    expect(keys({ ...COMPLETE, stage: "general", workplaces: [clinic] })).toEqual([]);
  });

  it("treats whitespace as empty", () => {
    expect(keys({ ...COMPLETE, email: "   " })).toEqual(["email"]);
  });
});
