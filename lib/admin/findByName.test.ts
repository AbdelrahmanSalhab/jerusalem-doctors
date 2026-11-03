// The name lookup proposes, never decides: what it returns for an exact name,
// a family name alone, a number someone else holds, and a doctor with no name.

import { beforeEach, describe, expect, it } from "vitest";
import { findByName } from "./findByName";

const ROWS = [
  { license_number: 189317, hebrew_first_name: "דניאל", hebrew_family_name: "דריפוס", hebrew_first_norm: "דניאל", hebrew_family_norm: "דריפוס", specialty_name_he: "רפואת ילדים" },
  { license_number: 222222, hebrew_first_name: "משה", hebrew_family_name: "דריפוס", hebrew_first_norm: "משה", hebrew_family_norm: "דריפוס", specialty_name_he: null },
];

const calls: { table: string; filters: string[] }[] = [];

// The registry read is asked twice: once for the exact name, once for the
// family alone (it carries a neq on the first name). Each gets its own rows.
function service(opts: { exact?: unknown[]; family?: unknown[]; held?: unknown[]; readError?: boolean } = {}) {
  return {
    from: (table: string) => {
      const call = { table, filters: [] as string[] };
      calls.push(call);
      const result = () => {
        if (table !== "moh_practitioners") return { data: opts.held ?? [], error: null };
        if (opts.readError) return { data: null, error: { message: "boom" } };
        return { data: (call.filters.some((f) => f.startsWith("neq:")) ? opts.family : opts.exact) ?? [], error: null };
      };
      const chain: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok) };
      for (const m of ["select", "in", "order", "limit"]) chain[m] = () => chain;
      for (const m of ["eq", "neq"]) chain[m] = (col: string, v: unknown) => (call.filters.push(`${m}:${col}=${String(v)}`), chain);
      return chain;
    },
  } as never;
}
const EXACT = [ROWS[0]];
const FAMILY = [ROWS[1]];

const DOC = { id: "d1", hebrew_first_name: "דניאל", hebrew_family_name: "דריפוס" };

describe("findByName", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("asks for the exact name on its own, so a large family cannot push it out", async () => {
    await findByName(service({ exact: EXACT, family: FAMILY }), DOC, "189371");
    const registry = calls.filter((c) => c.table === "moh_practitioners").map((c) => c.filters);
    expect(registry).toContainEqual(["eq:hebrew_family_norm=דריפוס", "eq:hebrew_first_norm=דניאל"]);
    expect(registry).toContainEqual(["eq:hebrew_family_norm=דריפוס", "neq:hebrew_first_norm=דניאל"]);
  });

  it("puts the exact name first and says how many digits it is off", async () => {
    const [first, second] = await findByName(service({ exact: EXACT, family: FAMILY }), DOC, "189371");
    expect(first).toMatchObject({ licenseNumber: "189317", kind: "exact", distance: 2, heldBy: null });
    expect(second).toMatchObject({ licenseNumber: "222222", kind: "family" });
  });

  it("names the doctor who already holds a candidate number", async () => {
    const held = [{ license_number: "189317", doctor_id: "d2", doctor: { arabic_first_name: "س", arabic_family_name: "ص" } }];
    const [first] = await findByName(service({ exact: EXACT, family: FAMILY, held }), DOC, "189371");
    expect(first.heldBy).toEqual({ id: "d2", name: "س ص" });
  });

  it("finds nothing for a doctor with no Hebrew name, without asking the registry", async () => {
    expect(await findByName(service({ readError: true }), { ...DOC, hebrew_first_name: null }, "1")).toEqual([]);
  });

  it("finds nothing when no one in the registry shares the family name", async () => {
    expect(await findByName(service(), DOC, "189371")).toEqual([]);
  });

  it("throws when the registry copy cannot be read, rather than reading as no match", async () => {
    await expect(findByName(service({ readError: true }), DOC, "1")).rejects.toThrow("moh_practitioners read failed");
  });
});
