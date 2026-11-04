// The name lookup proposes, never decides: what it returns for an exact name,
// a swapped one, a family name alone, a number someone already holds, and a
// doctor with no name.

import { beforeEach, describe, expect, it } from "vitest";
import { findByName } from "./findByName";

const row = (license_number: number, first: string, family: string) => ({
  license_number,
  hebrew_first_name: first,
  hebrew_family_name: family,
  hebrew_first_norm: first,
  hebrew_family_norm: family,
  specialty_name_he: null as string | null,
});
const ROWS = [row(189317, "דניאל", "דריפוס"), row(222222, "משה", "דריפוס")];

const calls: { table: string; filters: string[] }[] = [];

function service(
  opts: {
    exact?: unknown[];
    swapped?: unknown[];
    family?: unknown[];
    held?: unknown[];
    readError?: boolean;
    heldError?: boolean;
  } = {},
) {
  return {
    from: (table: string) => {
      const call = { table, filters: [] as string[] };
      calls.push(call);
      const result = () => {
        if (table !== "moh_practitioners") {
          return opts.heldError ? { data: null, error: { message: "boom" } } : { data: opts.held ?? [], error: null };
        }
        if (opts.readError) return { data: null, error: { message: "boom" } };
        // Three reads: both names, the names the wrong way round (the family
        // column asked for the doctor's first name), and the family alone.
        const asks = (col: string) => call.filters.find((f) => f.startsWith(`in:${col}=`));
        const rows = !asks("hebrew_first_norm")
          ? opts.family
          : asks("hebrew_family_norm")?.includes("דניאל")
            ? opts.swapped
            : opts.exact;
        return { data: rows ?? [], error: null };
      };
      const chain: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok) };
      for (const m of ["select", "order", "limit"]) chain[m] = () => chain;
      for (const m of ["eq", "neq", "in"]) {
        chain[m] = (col: string, v: unknown) => (call.filters.push(`${m}:${col}=${Array.isArray(v) ? v.join("|") : String(v)}`), chain);
      }
      return chain;
    },
  } as never;
}
const EXACT = [ROWS[0]];
const FAMILY = [ROWS[0], ROWS[1]];
const SWAPPED = [row(333333, "דריפוס", "דניאל")];

const DOC = { id: "d1", hebrew_first_name: "דניאל", hebrew_family_name: "דריפוס" };

describe("findByName", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("asks for the exact name on its own, so a large family cannot push it out", async () => {
    await findByName(service({ exact: EXACT, family: FAMILY }), DOC, "189371");
    const registry = calls.filter((c) => c.table === "moh_practitioners").map((c) => c.filters);
    expect(registry).toContainEqual(["in:hebrew_family_norm=דריפוס", "in:hebrew_first_norm=דניאל"]);
    expect(registry).toContainEqual(["in:hebrew_family_norm=דריפוס"]);
  });

  it("puts the exact name first and says how many digits it is off", async () => {
    const { candidates } = await findByName(service({ exact: EXACT, family: FAMILY }), DOC, "189371");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ licenseNumber: "189317", kind: "exact", distance: 2, heldBy: null, own: null });
    expect(candidates[1]).toMatchObject({ licenseNumber: "222222", kind: "family" });
  });

  it("finds a doctor who typed the two names the wrong way round, after the exact ones", async () => {
    const { candidates } = await findByName(service({ exact: EXACT, swapped: SWAPPED, family: FAMILY }), DOC, "189371");
    expect(candidates.map((c) => [c.kind, c.licenseNumber])).toEqual([
      ["exact", "189317"],
      ["swapped", "333333"],
      ["family", "222222"],
    ]);
  });

  it("does not look for a swapped reading when both names are the same word", async () => {
    await findByName(service(), { ...DOC, hebrew_first_name: "דריפוס" }, "1");
    expect(calls.filter((c) => c.table === "moh_practitioners")).toHaveLength(2);
  });

  it("also tries a double-barrelled name written with a space or a hyphen", async () => {
    await findByName(service(), { ...DOC, hebrew_family_name: "כהן-לוי" }, "1");
    const familyIn = calls.flatMap((c) => c.filters).filter((f) => f.startsWith("in:hebrew_family_norm=כהן"));
    expect(familyIn).toContain("in:hebrew_family_norm=כהן-לוי|כהן לוי");
  });

  describe("a large family", () => {
    // 30 other first names, the closest spelling holding the highest number.
    const big = [
      ...Array.from({ length: 30 }, (_, i) => row(100000 + i, `שם${i}`, "כהן")),
      row(999999, "דניאלה", "כהן"),
    ];
    const doc = { id: "d1", hebrew_first_name: "דניאל", hebrew_family_name: "כהן" };

    it("keeps the closest first name, not the lowest licence numbers, and says the list was cut", async () => {
      const { candidates, more } = await findByName(service({ family: big }), doc, "1");
      expect(candidates).toHaveLength(8);
      expect(candidates[0]).toMatchObject({ licenseNumber: "999999", kind: "family" });
      expect(more).toBe(true);
    });

    it("does not offer the exact first name a second time as a family match", async () => {
      const { candidates } = await findByName(service({ exact: [row(5, "דניאל", "כהן")], family: [row(5, "דניאל", "כהן")] }), doc, "1");
      expect(candidates.map((c) => c.kind)).toEqual(["exact"]);
    });

    it("says the list was cut when there are more exact names than it shows", async () => {
      const many = Array.from({ length: 21 }, (_, i) => row(200000 + i, "דניאל", "כהן"));
      const { candidates, more } = await findByName(service({ exact: many, family: many }), doc, "1");
      expect(candidates).toHaveLength(20);
      expect(more).toBe(true);
    });

    it("does not say it when everything fit", async () => {
      expect((await findByName(service({ exact: EXACT, family: FAMILY }), DOC, "1")).more).toBe(false);
    });
  });

  describe("who holds a candidate", () => {
    const slot = (number: string, doctor_id: string) => ({
      license_number: number,
      doctor_id,
      doctor: { arabic_first_name: "س", arabic_family_name: "ص" },
    });

    it("names another doctor who already holds the number, asking for Israeli slots only", async () => {
      const { candidates } = await findByName(service({ exact: EXACT, family: FAMILY, held: [slot("189317", "d2")] }), DOC, "189371");
      expect(candidates[0].heldBy).toEqual({ id: "d2", name: "س ص" });
      const heldRead = calls.find((c) => c.table === "doctor_license_slots");
      expect(heldRead?.filters).toContain("eq:license_region=IL");
      expect(heldRead?.filters.some((f) => f.startsWith("in:license_number=189317"))).toBe(true);
    });

    it("does not call the doctor's own number someone else's, and says whose it is", async () => {
      const held = [slot("189371", "d1"), slot("222222", "d1")];
      const { candidates } = await findByName(
        service({ exact: [row(189371, "דניאל", "דריפוס")], family: [row(189371, "דניאל", "דריפוס"), ROWS[1]], held }),
        DOC,
        "189371",
      );
      expect(candidates[0]).toMatchObject({ licenseNumber: "189371", own: "stored", heldBy: null, distance: 0 });
      expect(candidates[1]).toMatchObject({ licenseNumber: "222222", own: "other_slot", heldBy: null });
    });

    it("throws when the holders cannot be read, rather than reading as free", async () => {
      await expect(findByName(service({ exact: EXACT, family: FAMILY, heldError: true }), DOC, "1")).rejects.toThrow(
        "doctor_license_slots read failed",
      );
    });
  });

  it("finds nothing for a doctor with no Hebrew name, without asking the registry", async () => {
    expect(await findByName(service({ readError: true }), { ...DOC, hebrew_first_name: null }, "1")).toEqual({
      candidates: [],
      more: false,
    });
    expect(calls).toHaveLength(0);
  });

  it("finds nothing when no one in the registry shares the family name", async () => {
    expect(await findByName(service(), DOC, "189371")).toEqual({ candidates: [], more: false });
  });

  it("throws when the registry copy cannot be read, rather than reading as no match", async () => {
    await expect(findByName(service({ readError: true }), DOC, "1")).rejects.toThrow("moh_practitioners read failed");
  });
});
