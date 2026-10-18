import { describe, expect, it } from "vitest";
import {
  cleanWorkplaces,
  emptyWorkplace,
  isValidClinicPhone,
  missingClinicFields,
  toWorkplaceEntries,
  workplaceInfoLine,
} from "./workplace";

describe("toWorkplaceEntries", () => {
  it("gives a doctor with no saved rows one empty primary row", () => {
    expect(toWorkplaceEntries([])).toEqual([emptyWorkplace(true)]);
  });

  it("turns null columns into empty strings", () => {
    expect(
      toWorkplaceEntries([
        {
          name: "عيادة",
          workplace_type: "clinic",
          details: null,
          address: "شارع",
          hours: null,
          phone: null,
          is_primary: true,
          sort_order: 0,
        },
      ]),
    ).toEqual([
      {
        name: "عيادة",
        workplace_type: "clinic",
        details: "",
        address: "شارع",
        hours: "",
        phone: "",
        is_primary: true,
      },
    ]);
  });
});

describe("isValidClinicPhone", () => {
  it("accepts landlines, mobiles and international numbers", () => {
    for (const p of ["02-6271234", "0501234567", "+970 2 298 1234", "٠٢-٦٢٧١٢٣٤"]) {
      expect(isValidClinicPhone(p)).toBe(true);
    }
  });

  it("rejects too short, too long or non-numeric input", () => {
    for (const p of ["", "12345", "1234567890123456", "عيادة"]) {
      expect(isValidClinicPhone(p)).toBe(false);
    }
  });
});

describe("missingClinicFields", () => {
  const clinic = { name: "عيادة النور", workplace_type: "clinic" as const, address: "", phone: "" };

  it("requires address and phone on a named specialist clinic", () => {
    expect(missingClinicFields(clinic)).toEqual(["address", "phone"]);
    expect(missingClinicFields({ ...clinic, address: "القدس", phone: "02-6271234" })).toEqual([]);
  });

  it("flags an unreadable phone the same as a missing one", () => {
    expect(missingClinicFields({ ...clinic, address: "القدس", phone: "123" })).toEqual(["phone"]);
  });

  it("asks nothing of a hospital row or an unnamed clinic row", () => {
    expect(missingClinicFields({ ...clinic, workplace_type: "hospital" })).toEqual([]);
    expect(missingClinicFields({ ...clinic, name: "  " })).toEqual([]);
  });
});

describe("workplaceInfoLine", () => {
  it("joins the clinic fields that are set", () => {
    expect(
      workplaceInfoLine({ address: "القدس", hours: "", phone: "02-6271234", details: null }),
    ).toBe("القدس · 02-6271234");
  });

  it("falls back to the legacy free-text details", () => {
    expect(
      workplaceInfoLine({ address: null, hours: null, phone: null, details: "ص ٨-١٢" }),
    ).toBe("ص ٨-١٢");
  });

  it("is null when there is nothing to show", () => {
    expect(workplaceInfoLine({ address: "", hours: null, phone: null, details: "" })).toBeNull();
  });
});

describe("cleanWorkplaces", () => {
  it("drops unnamed rows and nulls blank fields", () => {
    const row = {
      name: " عيادة النور ",
      workplace_type: "clinic" as const,
      details: "",
      address: " القدس ",
      hours: "  ",
      phone: "02-6271234",
      is_primary: true,
    };
    expect(cleanWorkplaces([row, { ...row, name: " ", is_primary: false }])).toEqual([
      {
        name: "عيادة النور",
        workplace_type: "clinic",
        details: null,
        address: "القدس",
        hours: null,
        phone: "02-6271234",
        is_primary: true,
      },
    ]);
  });
});
