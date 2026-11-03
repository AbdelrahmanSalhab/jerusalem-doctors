// The name lookup proposes, never decides: what it returns for an exact name,
// a family name alone, a number someone else holds, and a doctor with no name.

import { describe, expect, it } from "vitest";
import { findByName } from "./findByName";

const ROWS = [
  { license_number: 189317, hebrew_first_name: "דניאל", hebrew_family_name: "דריפוס", hebrew_first_norm: "דניאל", hebrew_family_norm: "דריפוס", specialty_name_he: "רפואת ילדים" },
  { license_number: 222222, hebrew_first_name: "משה", hebrew_family_name: "דריפוס", hebrew_first_norm: "משה", hebrew_family_norm: "דריפוס", specialty_name_he: null },
];

function service(opts: { rows?: unknown[]; held?: unknown[]; readError?: boolean } = {}) {
  const query = (data: unknown, error: unknown = null) => {
    const chain: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(ok) };
    for (const m of ["select", "eq", "in", "neq", "limit"]) chain[m] = () => chain;
    return chain;
  };
  return {
    from: (t: string) =>
      t === "moh_practitioners"
        ? query(opts.rows ?? ROWS, opts.readError ? { message: "boom" } : null)
        : query(opts.held ?? []),
  } as never;
}

const DOC = { id: "d1", hebrew_first_name: "דניאל", hebrew_family_name: "דריפוס" };

describe("findByName", () => {
  it("puts the exact name first and says how many digits it is off", async () => {
    const [first, second] = await findByName(service(), DOC, "189371");
    expect(first).toMatchObject({ licenseNumber: "189317", kind: "exact", distance: 2, heldBy: null });
    expect(second).toMatchObject({ licenseNumber: "222222", kind: "family" });
  });

  it("names the doctor who already holds a candidate number", async () => {
    const held = [{ license_number: "189317", doctor_id: "d2", doctor: { arabic_first_name: "س", arabic_family_name: "ص" } }];
    const [first] = await findByName(service({ held }), DOC, "189371");
    expect(first.heldBy).toEqual({ id: "d2", name: "س ص" });
  });

  it("finds nothing for a doctor with no Hebrew name, without asking the registry", async () => {
    expect(await findByName(service({ readError: true }), { ...DOC, hebrew_first_name: null }, "1")).toEqual([]);
  });

  it("finds nothing when no one in the registry shares the family name", async () => {
    expect(await findByName(service({ rows: [] }), DOC, "189371")).toEqual([]);
  });

  it("throws when the registry copy cannot be read, rather than reading as no match", async () => {
    await expect(findByName(service({ readError: true }), DOC, "1")).rejects.toThrow("moh_practitioners read failed");
  });
});
