import { describe, expect, it } from "vitest";
import { cardChips, toSearchHits } from "@/lib/directory";

const ROW = {
  id: "d1",
  arabic_first_name: "أحمد",
  arabic_family_name: "الخطيب",
  hebrew_first_name: null,
  hebrew_family_name: null,
  license_number: "123456",
  phone_display: null,
  phone_e164: "",
  profile_picture_url: null,
  email: null,
  subspecialty: null,
  bio: null,
  career_stage: null,
  residency_start_year: null,
  certificates: null,
  seeking_work: null,
  doctor_specialties: [{ specialty: { name_ar: "الطب العام" } }],
  doctor_workplaces: [
    { name: "ب", workplace_type: "clinic", details: null, address: null, hours: null, phone: null, is_primary: false, sort_order: 2 },
    { name: "أ", workplace_type: "hospital", details: null, address: null, hours: null, phone: null, is_primary: true, sort_order: 5 },
  ],
};

describe("toSearchHits", () => {
  it("defaults the 0013 columns and puts the primary workplace first", () => {
    const [hit] = toSearchHits([ROW]);
    expect(hit.certificates).toEqual([]);
    expect(hit.seeking_work).toBe(false);
    expect(hit.whatsapp_url).toBeNull();
    expect(hit.workplaces.map((w) => w.name)).toEqual(["أ", "ب"]);
    expect(hit.specialties).toEqual(["الطب العام"]);
  });

  it("returns [] for no data", () => {
    expect(toSearchHits(null)).toEqual([]);
  });
});

describe("cardChips", () => {
  const gp = { career_stage: null, specialties: ["الطب العام"], certificates: ["ACLS"] };

  it("shows a طب عام doctor's certificates instead of الطب العام", () => {
    expect(cardChips(gp)).toEqual(["ACLS"]);
  });

  it("falls back to specialties without certificates", () => {
    expect(cardChips({ ...gp, certificates: [] })).toEqual(["الطب العام"]);
  });

  it("ignores certificates for any other stage", () => {
    expect(cardChips({ ...gp, career_stage: "specialist" as const })).toEqual(["الطب العام"]);
  });
});
