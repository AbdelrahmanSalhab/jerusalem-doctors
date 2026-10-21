import { describe, expect, it } from "vitest";
import { cardChips, rankRecent, type SearchHit, toSearchHits } from "@/lib/directory";

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
  retired: null,
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
    expect(hit.retired).toBe(false);
    expect(hit.whatsapp_url).toBeNull();
    expect(hit.workplaces.map((w) => w.name)).toEqual(["أ", "ب"]);
    expect(hit.specialties).toEqual(["الطب العام"]);
  });

  it("never passes the license number on to the browser", () => {
    const [hit] = toSearchHits([ROW]);
    expect(JSON.stringify(hit)).not.toContain("123456");
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

describe("rankRecent", () => {
  const hit = (id: string, specialties: string[], institutions: string[] = []) =>
    ({ id, specialties, workplaces: institutions.map((i) => ({ institution_id: i })) }) as unknown as SearchHit;
  const domainOf = (name: string) => ({ القلب: "internal", الباطنية: "internal", الأطفال: "peds" })[name];
  const me = { id: "me", domains: new Set(["internal"]), institutions: new Set(["makassed"]) };

  it("puts my specialty area first, then my hospital, newest first within each, and leaves me out", () => {
    const recent = [
      hit("newest-other", ["الأطفال"]),
      hit("me", ["القلب"]),
      hit("same-hospital", ["الأطفال"], ["makassed"]),
      hit("same-domain", ["القلب"]),
      hit("both", ["الباطنية"], ["makassed"]),
    ];
    expect(rankRecent(recent, me, domainOf).map((d) => d.id)).toEqual(["both", "same-domain", "same-hospital", "newest-other"]);
  });

  it("shows at most six", () => {
    const many = Array.from({ length: 10 }, (_, i) => hit(`d${i}`, ["الأطفال"]));
    expect(rankRecent(many, me, domainOf)).toHaveLength(6);
  });
});
