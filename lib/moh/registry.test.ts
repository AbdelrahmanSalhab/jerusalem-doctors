import { describe, expect, it } from "vitest";
import type { MohRecord } from "./client";
import { registryDate, toRegistryRows } from "./registry";

const row = (over: Partial<MohRecord>): MohRecord => ({
  _id: 1,
  "שם פרטי": "דניאל",
  "שם משפחה": "דריפוס",
  "מספר רישיון רופא": 13846,
  "תאריך רישום רישיון": 23101979,
  ...over,
});

describe("registryDate", () => {
  it("reads the registry's DDMMYYYY", () => {
    expect(registryDate(22111979)).toBe("1979-11-22");
    expect(registryDate(1012001)).toBe("2001-01-01");
  });

  it("is null for nothing or an impossible date", () => {
    expect(registryDate(null)).toBeNull();
    expect(registryDate(0)).toBeNull();
    expect(registryDate(31022020)).toBeNull();
  });
});

describe("toRegistryRows", () => {
  it("keeps every certificate of a licence, oldest first, the newest as its specialty", () => {
    const [r, ...rest] = toRegistryRows([
      row({ "שם התמחות": "נפרולוגיה ילדים", "תאריך רישום התמחות": 11101994 }),
      row({ "שם התמחות": "נפרולוגיה", "תאריך רישום התמחות": 19021992 }),
    ]);
    expect(rest).toEqual([]);
    expect(r).toMatchObject({
      license_number: 13846,
      specialties: ["נפרולוגיה", "נפרולוגיה ילדים"],
      specialty_name_he: "נפרולוגיה ילדים",
      specialist_since: "1992-02-19",
      license_issued_on: "1979-10-23",
    });
  });

  it("does not let a blank row hide a certificate", () => {
    const [r] = toRegistryRows([
      row({ "שם התמחות": "פנימית", "תאריך רישום התמחות": 1012010 }),
      row({ "שם התמחות": "  " }),
    ]);
    expect(r.specialties).toEqual(["פנימית"]);
    expect(r.specialty_name_he).toBe("פנימית");
  });

  it("gives a licence with no certificate no specialty", () => {
    const [r] = toRegistryRows([row({ "שם התמחות": null })]);
    expect(r).toMatchObject({ specialties: [], specialty_name_he: null, specialist_since: null });
  });

  it("returns one row per licence and skips rows without a name", () => {
    const rows = toRegistryRows([row({}), row({ "מספר רישיון רופא": 5 }), row({ "מספר רישיון רופא": 6, "שם פרטי": "" })]);
    expect(rows.map((r) => r.license_number)).toEqual([13846, 5]);
  });
});
