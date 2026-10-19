import { describe, expect, it } from "vitest";
import { doctorVCard } from "./vcard";

const doc = {
  arabic_first_name: "ليلى",
  arabic_family_name: "الخطيب",
  phone_e164: "+972528697375",
  email: "layla@example.com",
  specialties: ["الباطنية", "القلب"],
  license_number: "189371",
  workplaces: [
    { name: "عيادة النور", workplace_type: "clinic" as const, details: null, address: null, hours: null, phone: "02-6271234", is_primary: false },
    { name: "المقاصد", workplace_type: "hospital" as const, details: null, address: null, hours: null, phone: null, is_primary: true },
  ],
};

describe("doctorVCard", () => {
  it("carries name, phones, email, workplace, specialties and licence", () => {
    const v = doctorVCard(doc);
    expect(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(v).toContain("FN;CHARSET=UTF-8:د. ليلى الخطيب");
    expect(v).toContain("TEL;TYPE=CELL:+972528697375");
    expect(v).toContain("TEL;TYPE=WORK:02-6271234");
    expect(v).toContain("ORG;CHARSET=UTF-8:المقاصد");
    expect(v).toContain("TITLE;CHARSET=UTF-8:الباطنية، القلب");
    expect(v).toContain("ترخيص 189371");
    expect(v.trim().endsWith("END:VCARD")).toBe(true);
  });

  it("escapes separators and skips what is missing", () => {
    const v = doctorVCard({ ...doc, email: null, phone_e164: null, workplaces: [{ ...doc.workplaces[1], name: "مستشفى; أ, ب" }] });
    expect(v).toContain("ORG;CHARSET=UTF-8:مستشفى\\; أ\\, ب");
    expect(v).not.toContain("EMAIL");
    expect(v).not.toContain("TYPE=CELL");
  });
});
