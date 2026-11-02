import { describe, expect, it } from "vitest";
import { explainDate, explainLicense, type ExplainInput } from "./explain";
import type { MirrorPractitioner } from "./mirror";

const ROW: MirrorPractitioner = {
  licenseNumber: 189371,
  hebrewFirstName: "דניאל",
  hebrewFamilyName: "דריפוס",
  hebrewFirstNorm: "דניאל",
  hebrewFamilyNorm: "דריפוס",
  specialtyHe: "פנימית",
  specialties: ["פנימית"],
  licenseIssuedOn: "2011-05-03",
  specialistSince: "2017-02-01",
  syncedAt: "2026-10-19T03:00:00.000Z",
};

function input(over: Partial<ExplainInput> = {}): ExplainInput {
  return {
    status: "verified",
    region: "IL",
    licenseNumber: "189371",
    hebrewFirstName: "דניאל",
    hebrewFamilyName: "דריפוס",
    registryRow: ROW,
    mirrorSyncedAt: "2026-10-19T03:00:00.000Z",
    licenseVerifiedAt: "2026-09-01T10:00:00.000Z",
    ...over,
  };
}

const text = (i: ExplainInput) => {
  const e = explainLicense(i);
  return [e.headline, ...e.reasons, e.nextStep ?? ""].join(" ");
};

describe("explainLicense", () => {
  it("explains an exact match, naming the registry row", () => {
    const e = explainLicense(input());
    expect(e.code).toBe("verified_exact");
    expect(e.tone).toBe("success");
    expect(e.nextStep).toBeNull();
    expect(text(input())).toContain("דניאל דריפוס");
    expect(text(input())).toContain("פנימית");
  });

  describe("a partial match", () => {
    it("names the rule that fired for each part of the name", () => {
      const e = explainLicense(
        input({ status: "soft_match", match: { first: "edit1", family: "exact" } }),
      );
      expect(e.code).toBe("soft_match_rules");
      expect(e.reasons.some((r) => r.includes("الاسم الأول") && r.includes("حرف واحد"))).toBe(true);
      expect(e.reasons.some((r) => r.includes("اسم العائلة") && r.includes("مطابق تمامًا"))).toBe(true);
      // A fresh comparison is not a guess about the past.
      expect(e.derivedNow).toBe(false);
    });

    it("explains a compound or shortened name as a substring", () => {
      const e = explainLicense(input({ status: "soft_match", match: { first: "substring", family: "exact" } }));
      expect(e.reasons.some((r) => r.includes("أحد الاسمين يحتوي الآخر"))).toBe(true);
    });

    it("re-derives the rules from today's copy when none was supplied, and says so", () => {
      const e = explainLicense(
        input({ status: "soft_match", hebrewFirstName: "דניא", match: undefined }),
      );
      expect(e.code).toBe("soft_match_rules");
      expect(e.derivedNow).toBe(true);
      expect(e.reasons.some((r) => r.includes("أحد الاسمين يحتوي الآخر"))).toBe(true);
    });

    it("admits it cannot explain when the registry no longer has the number", () => {
      const e = explainLicense(input({ status: "soft_match", registryRow: null }));
      expect(e.code).toBe("soft_match_unknown_rule");
      expect(e.derivedNow).toBe(true);
      expect(e.nextStep).toContain("بحث في السجل");
    });

    // A bare 6-digit serial beginning with 1 is genuinely two readings: the
    // serial itself, or the "1-" profession prefix glued to a 5-digit one.
    it("warns when the stored number could have been read two ways", () => {
      const e = explainLicense(
        input({ status: "soft_match", licenseNumber: "189371", match: { first: "edit1", family: "exact" } }),
      );
      expect(e.reasons.some((r) => r.includes("يمكن أن يُقرأ بطريقتين"))).toBe(true);
    });

    it("stays quiet when the number can only be read one way", () => {
      // Starts with 2, so no profession prefix could have been dropped.
      const bare = explainLicense(
        input({ status: "soft_match", licenseNumber: "23456", match: { first: "edit1", family: "exact" } }),
      );
      expect(bare.reasons.some((r) => r.includes("بطريقتين"))).toBe(false);
      // An explicitly prefixed number is not ambiguous either.
      const prefixed = explainLicense(
        input({ status: "soft_match", licenseNumber: "1189371", match: { first: "edit1", family: "exact" } }),
      );
      expect(prefixed.reasons.some((r) => r.includes("بطريقتين"))).toBe(false);
    });
  });

  // The whole point of splitting not_found: three different truths used to
  // render as one warning.
  describe("not found", () => {
    it("never tells an admin a Palestinian licence is absent from the registry", () => {
      const e = explainLicense(input({ status: "not_found", region: "PS", licenseNumber: "44/2", registryRow: null }));
      expect(e.code).toBe("not_found_ps");
      expect(e.tone).toBe("neutral");
      const all = text(input({ status: "not_found", region: "PS", registryRow: null }));
      expect(all).not.toContain("غير موجود في السجل.");
      expect(all).toContain("لم يُفحص");
      expect(all).toContain("لا تعني أن الرقم خاطئ");
    });

    it("mentions an Israeli second licence when a Palestinian one is the primary", () => {
      const e = explainLicense(
        input({ status: "not_found", region: "PS", registryRow: null, hasSecondaryIl: true }),
      );
      expect(e.reasons.some((r) => r.includes("ترخيص إضافي إسرائيلي"))).toBe(true);
    });

    it("reads PS before the status, so even a stray status cannot mislabel it", () => {
      expect(explainLicense(input({ status: "verified", region: "PS" })).code).toBe("not_found_ps");
      expect(explainLicense(input({ status: null, region: "PS" })).code).toBe("not_found_ps");
    });

    it("says the number is absent, with the sync date, when the copy has no row", () => {
      const e = explainLicense(input({ status: "not_found", registryRow: null }));
      expect(e.code).toBe("not_found_absent");
      expect(e.reasons[0]).toContain("19/10/2026");
      expect(e.nextStep).toContain("موقع الوزارة");
    });

    it("flags a number the registry does have today as a stale verdict", () => {
      const e = explainLicense(input({ status: "not_found" }));
      expect(e.code).toBe("not_found_now_present");
      expect(e.derivedNow).toBe(true);
      expect(e.reasons.join(" ")).toContain("انقطاع");
      expect(e.nextStep).toContain("دون تعديل الرقم");
    });

    it("explains that no Hebrew name means no comparison is possible", () => {
      const e = explainLicense(
        input({ status: "not_found", hebrewFirstName: null, hebrewFamilyName: null, registryRow: null }),
      );
      expect(e.code).toBe("not_found_no_hebrew_name");
      expect(e.nextStep).toContain("الاسم العبري");
    });
  });

  describe("an overridden mismatch", () => {
    it("says the doctor waved the warning through themselves", () => {
      const e = explainLicense(input({ status: "name_mismatch_overridden", hebrewFirstName: "אברהם" }));
      expect(e.code).toBe("mismatch_overridden");
      expect(e.tone).toBe("danger");
      expect(e.reasons.join(" ")).toContain("דניאל דריפוס");
      expect(e.reasons.join(" ")).toContain("وافق الطبيب");
    });

    it("cannot show the registry spelling once the row is gone", () => {
      const e = explainLicense(input({ status: "name_mismatch_overridden", registryRow: null }));
      expect(e.code).toBe("mismatch_overridden_row_gone");
      expect(e.tone).toBe("danger");
    });
  });

  it("handles a never-checked licence rather than falling through", () => {
    for (const status of [null, "", "something_else"]) {
      const e = explainLicense(input({ status, registryRow: null }));
      expect(e.code).toBe("unchecked");
      expect(e.tone).toBe("neutral");
      expect(e.nextStep).toContain("بحث في السجل");
    }
  });

  it("always gives an admin Arabic text and at least one reason", () => {
    const cases: Partial<ExplainInput>[] = [
      {},
      { status: "soft_match" },
      { status: "soft_match", registryRow: null },
      { status: "not_found" },
      { status: "not_found", registryRow: null },
      { status: "not_found", region: "PS" },
      { status: "name_mismatch_overridden" },
      { status: "name_mismatch_overridden", registryRow: null },
      { status: null },
    ];
    for (const over of cases) {
      const e = explainLicense(input(over));
      expect(e.headline).toMatch(/[؀-ۿ]/);
      expect(e.reasons.length).toBeGreaterThan(0);
      for (const r of e.reasons) expect(r).toMatch(/[؀-ۿ]/);
    }
  });

  it("survives a missing sync date without printing an empty gap", () => {
    const e = explainLicense(input({ status: "not_found", registryRow: null, mirrorSyncedAt: null }));
    expect(e.reasons[0]).toContain("غير معروف");
  });
});

describe("explainLicense: the edges", () => {
  it("says a date is unknown when it is missing or unreadable", () => {
    expect(explainDate(null)).toBe("غير معروف");
    expect(explainDate("not a date")).toBe("غير معروف");
    expect(explainDate("2026-10-19T03:00:00Z")).toBe("19/10/2026");
  });

  it("explains a soft match for a doctor with no Hebrew name stored, and without a fresh comparison", () => {
    const e = explainLicense(input({ status: "soft_match", hebrewFirstName: null, hebrewFamilyName: null }));
    expect(e.code).toBe("soft_match_rules");
    expect(e.reasons.join(" ")).not.toContain("الاسم العبري المسجَّل لدينا");
  });

  it("explains a soft match that was just re-checked, using the fresh comparison", () => {
    const e = explainLicense(input({ status: "soft_match", match: { first: "exact", family: "edit1" } }));
    expect(e.derivedNow).toBe(false);
  });

  it("explains an overridden mismatch without our own Hebrew name, and when the registry row is not in the copy", () => {
    const noName = explainLicense(input({ status: "name_mismatch_overridden", hebrewFirstName: null, hebrewFamilyName: null }));
    expect(noName.code).toBe("mismatch_overridden");
    expect(noName.reasons.join(" ")).not.toContain("الاسم العبري المسجَّل لدينا");
  });

  it("explains a not-found for a doctor with no Hebrew name, with or without a registry row", () => {
    const withRow = explainLicense(input({ status: "not_found", hebrewFirstName: null, hebrewFamilyName: null }));
    expect(withRow.code).toBe("not_found_no_hebrew_name");
    expect(withRow.reasons).toHaveLength(2);
    const noRow = explainLicense(input({ status: "not_found", hebrewFirstName: null, hebrewFamilyName: null, registryRow: null }));
    expect(noRow.reasons).toHaveLength(1);
  });

  it("adds no ambiguity note for a Palestinian licence or an empty number", () => {
    const ps = explainLicense(input({ region: "PS", status: "soft_match", licenseNumber: "123456" }));
    expect(ps.reasons.join(" ")).not.toContain("ملاحظة");
    const empty = explainLicense(input({ status: "soft_match", licenseNumber: "" }));
    expect(empty).toBeTruthy();
  });
});
