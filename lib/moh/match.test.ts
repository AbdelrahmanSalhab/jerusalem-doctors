import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MohClient, type MohRecord } from "./client";
import { resolveIlLicense, verifyLicense } from "./match";

function fakeSupabase(row: {
  license_number: number;
  hebrew_first_name: string;
  hebrew_family_name: string;
  hebrew_first_norm: string;
  hebrew_family_norm: string;
  specialty_name_he: string | null;
} | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function fakeMohClient(record: MohRecord | null) {
  return {
    findByLicense: vi.fn(async () => record),
  } as unknown as MohClient;
}

const MIRROR_ROW = {
  license_number: 9417,
  hebrew_first_name: "דניאל",
  hebrew_family_name: "דריפוס",
  hebrew_first_norm: "דניאל",
  hebrew_family_norm: "דריפוס",
  specialty_name_he: "פסיכיאטריה",
};

describe("verifyLicense (mirror path)", () => {
  it("returns verified on exact name match", async () => {
    const r = await verifyLicense(fakeSupabase(MIRROR_ROW), {
      licenseNumber: 9417,
      hebrewFirstName: "דניאל",
      hebrewFamilyName: "דריפוס",
    });
    expect(r.status).toBe("verified");
    expect(r.source).toBe("mirror");
    expect(r.registrySpecialtyHe).toBe("פסיכיאטריה");
  });

  it("ignores niqqud in user input (verified after normalize)", async () => {
    const r = await verifyLicense(fakeSupabase(MIRROR_ROW), {
      licenseNumber: 9417,
      hebrewFirstName: "דָּנִיֵּאל",
      hebrewFamilyName: "דריפוס",
    });
    expect(r.status).toBe("verified");
  });

  it("returns soft_match on a 1-edit-distance family name", async () => {
    const r = await verifyLicense(fakeSupabase(MIRROR_ROW), {
      licenseNumber: 9417,
      hebrewFirstName: "דניאל",
      hebrewFamilyName: "דריפום", // ס -> ם
    });
    expect(r.status).toBe("soft_match");
    expect(r.registryFamilyName).toBe("דריפוס");
  });

  it("returns soft_match on substring (e.g., דוד / דויד)", async () => {
    const row = { ...MIRROR_ROW, hebrew_first_norm: "דויד", hebrew_first_name: "דויד" };
    const r = await verifyLicense(fakeSupabase(row), {
      licenseNumber: 9417,
      hebrewFirstName: "דוד",
      hebrewFamilyName: "דריפוס",
    });
    expect(r.status).toBe("soft_match");
  });

  it("returns name_mismatch when names diverge meaningfully", async () => {
    const r = await verifyLicense(fakeSupabase(MIRROR_ROW), {
      licenseNumber: 9417,
      hebrewFirstName: "אחמד",
      hebrewFamilyName: "אלחטיב",
    });
    expect(r.status).toBe("name_mismatch");
    expect(r.registryFirstName).toBe("דניאל");
    expect(r.registryFamilyName).toBe("דריפוס");
  });
});

describe("verifyLicense (live fallback)", () => {
  it("falls back to CKAN when mirror has no row, then verifies", async () => {
    const liveRecord: MohRecord = {
      _id: 1,
      "שם פרטי": "אחמד",
      "שם משפחה": "אלחטיב",
      "מספר רישיון רופא": 12345,
      "שם התמחות": "רפואת המשפחה",
    };
    const r = await verifyLicense(
      fakeSupabase(null),
      {
        licenseNumber: 12345,
        hebrewFirstName: "אחמד",
        hebrewFamilyName: "אלחטיב",
      },
      { mohClient: fakeMohClient(liveRecord) },
    );
    expect(r.status).toBe("verified");
    expect(r.source).toBe("live");
    expect(r.registrySpecialtyHe).toBe("רפואת המשפחה");
  });

  it("returns not_found when CKAN also has no row", async () => {
    const r = await verifyLicense(
      fakeSupabase(null),
      {
        licenseNumber: 99999,
        hebrewFirstName: "שלום",
        hebrewFamilyName: "כהן",
      },
      { mohClient: fakeMohClient(null) },
    );
    expect(r.status).toBe("not_found");
    expect(r.source).toBe("none");
  });
});

describe("resolveIlLicense", () => {
  /** A mirror keyed by license number, so each candidate looks up its own row. */
  function mirrorOf(rows: (typeof MIRROR_ROW)[]) {
    const lookups: number[] = [];
    const client = {
      from: () => ({
        select: () => ({
          eq: (_col: string, license: number) => ({
            maybeSingle: async () => {
              lookups.push(license);
              return {
                data: rows.find((r) => r.license_number === license) ?? null,
                error: null,
              };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    return { client, lookups };
  }

  const NAMES = { hebrewFirstName: "דניאל", hebrewFamilyName: "דריפוס" };
  const OTHER = {
    ...MIRROR_ROW,
    hebrew_first_name: "משה",
    hebrew_family_name: "כהן",
    hebrew_first_norm: "משה",
    hebrew_family_norm: "כהן",
  };
  const offline = { mohClient: fakeMohClient(null) };

  it("finds the doctor under the serial without the typed prefix", async () => {
    const { client } = mirrorOf([{ ...MIRROR_ROW, license_number: 23456 }]);
    const r = await resolveIlLicense(
      client,
      { candidates: ["123456", "23456"], ...NAMES },
      offline,
    );
    expect(r.serial).toBe("23456");
    expect(r.result.status).toBe("verified");
  });

  it("prefers the as-typed serial when it verifies, without a second lookup", async () => {
    const { client, lookups } = mirrorOf([
      { ...MIRROR_ROW, license_number: 123456 },
      { ...OTHER, license_number: 23456 },
    ]);
    const r = await resolveIlLicense(
      client,
      { candidates: ["123456", "23456"], ...NAMES },
      offline,
    );
    expect(r.serial).toBe("123456");
    expect(r.result.status).toBe("verified");
    expect(lookups).toEqual([123456]);
  });

  it("takes a name match on the stripped serial over a mismatch as typed", async () => {
    // 123456 belongs to someone else; the doctor is 23456.
    const { client } = mirrorOf([
      { ...OTHER, license_number: 123456 },
      { ...MIRROR_ROW, license_number: 23456 },
    ]);
    const r = await resolveIlLicense(
      client,
      { candidates: ["123456", "23456"], ...NAMES },
      offline,
    );
    expect(r.serial).toBe("23456");
    expect(r.result.status).toBe("verified");
  });

  it("keeps the as-typed mismatch when the stripped serial is not found", async () => {
    const { client } = mirrorOf([{ ...OTHER, license_number: 123456 }]);
    const r = await resolveIlLicense(
      client,
      { candidates: ["123456", "23456"], ...NAMES },
      offline,
    );
    expect(r.serial).toBe("123456");
    expect(r.result.status).toBe("name_mismatch");
  });

  it("falls back to the as-typed serial when nothing is found", async () => {
    const { client } = mirrorOf([]);
    const r = await resolveIlLicense(
      client,
      { candidates: ["123456", "23456"], ...NAMES },
      offline,
    );
    expect(r.serial).toBe("123456");
    expect(r.result.status).toBe("not_found");
  });
});
