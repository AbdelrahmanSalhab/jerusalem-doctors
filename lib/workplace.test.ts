import { describe, expect, it } from "vitest";
import {
  hasInvalidClinicPhone,
  clinicTelHref,
  mapLinks,
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

describe("clinicTelHref", () => {
  it("keeps digits and a leading plus", () => {
    expect(clinicTelHref("02-627 1234")).toBe("tel:026271234");
    expect(clinicTelHref("+972 2-627-1234")).toBe("tel:+97226271234");
  });

  it("returns null when there is nothing to dial", () => {
    expect(clinicTelHref(null)).toBeNull();
    expect(clinicTelHref("  ")).toBeNull();
  });
});

describe("mapLinks", () => {
  it("builds Google Maps and Waze search links for the address", () => {
    expect(mapLinks("شارع صلاح الدين 12، القدس")).toEqual({
      google: "https://www.google.com/maps/search/?api=1&query=%D8%B4%D8%A7%D8%B1%D8%B9%20%D8%B5%D9%84%D8%A7%D8%AD%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%2012%D8%8C%20%D8%A7%D9%84%D9%82%D8%AF%D8%B3",
      waze: "https://waze.com/ul?q=%D8%B4%D8%A7%D8%B1%D8%B9%20%D8%B5%D9%84%D8%A7%D8%AD%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%2012%D8%8C%20%D8%A7%D9%84%D9%82%D8%AF%D8%B3&navigate=yes",
    });
  });

  it("returns null without an address", () => {
    expect(mapLinks(null)).toBeNull();
    expect(mapLinks(" ")).toBeNull();
  });
});

describe("hasInvalidClinicPhone", () => {
  const w = (phone: string) => ({ name: "عيادة", workplace_type: "clinic" as const, phone });
  it("accepts an empty or valid phone", () => {
    expect(hasInvalidClinicPhone(w(""))).toBe(false);
    expect(hasInvalidClinicPhone(w("02-6271234"))).toBe(false);
  });
  it("flags a typed but invalid phone on a named row", () => {
    expect(hasInvalidClinicPhone(w("12"))).toBe(true);
    expect(hasInvalidClinicPhone({ ...w("12"), name: " " })).toBe(false);
  });
});
