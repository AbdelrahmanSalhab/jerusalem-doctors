// Relinking workplaces to institutions and counting who works where, against a
// client that answers each table from a script.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { institutionUsage, relinkDoctor, relinkWorkplaces } from "@/lib/institutions";

type Result = { data?: unknown; error?: unknown };

/** Each `from(table)` takes the next scripted result for that table. */
function scripted(script: Record<string, Result[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const client = {
    from(table: string) {
      const result = script[table]?.shift() ?? {};
      const chain: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...result }).then(ok) };
      for (const m of ["select", "order", "range", "eq", "in", "update"]) chain[m] = (...args: unknown[]) => (calls.push({ table, method: m, args }), chain);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const INSTITUTIONS = [
  { id: "i1", name_ar: "مستشفى المقاصد", name_he: null, kind: "hospital", aliases: [] },
  { id: "i2", name_ar: "كلاليت", name_he: null, kind: "hmo", aliases: [] },
];
const wp = (id: string, name: string, institution_id: string | null = null, workplace_type = "hospital") => ({ id, name, workplace_type, institution_id });

afterEach(() => vi.restoreAllMocks());

describe("relinkWorkplaces", () => {
  it("moves the rows whose match changed, in chunks, and lists the hospital names nobody matched", async () => {
    const rows = [wp("w1", "مستشفى المقاصد"), wp("w2", "مستشفى غير معروف"), wp("w3", "مستشفى غير معروف"), wp("w4", "عيادة خاصة", null, "clinic"), wp("w5", "مستشفى المقاصد", "i1")];
    const { client, calls } = scripted({ institutions: [{ data: INSTITUTIONS }], doctor_workplaces: [{ data: rows }, {}] });
    const out = await relinkWorkplaces(client, "d1");
    expect(out).toEqual({ changed: 1, unmatched: [{ name: "مستشفى غير معروف", count: 2 }] });
    expect(calls.find((c) => c.method === "update")?.args[0]).toEqual({ institution_id: "i1" });
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "doctor_id")).toBe(true);
  });

  it("reads a second page when the first is full, and updates 150 at a time", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => wp(`w${i}`, "مستشفى المقاصد"));
    const { client, calls } = scripted({ institutions: [{ data: INSTITUTIONS }], doctor_workplaces: [{ data: page }, { data: [] }, {}, {}, {}, {}, {}, {}, {}] });
    const out = await relinkWorkplaces(client);
    expect(out.changed).toBe(1000);
    expect(calls.filter((c) => c.method === "update")).toHaveLength(7);
    expect(calls.filter((c) => c.method === "range")).toHaveLength(2);
  });

  it("sorts several unmatched names by count, then by name", async () => {
    const rows = [wp("a", "ب"), wp("b", "أ"), wp("c", "أ"), wp("d", "ج")];
    const { client } = scripted({ institutions: [{ data: [] }], doctor_workplaces: [{ data: rows }] });
    expect((await relinkWorkplaces(client)).unmatched.map((u) => u.name)).toEqual(["أ", "ب", "ج"]);
  });

  it("throws when a read or an update fails", async () => {
    await expect(relinkWorkplaces(scripted({ institutions: [{ error: new Error("i") }] }).client)).rejects.toThrow("i");
    await expect(relinkWorkplaces(scripted({ institutions: [{ data: INSTITUTIONS }], doctor_workplaces: [{ error: new Error("w") }] }).client)).rejects.toThrow("w");
    const failing = scripted({ institutions: [{ data: INSTITUTIONS }], doctor_workplaces: [{ data: [wp("w1", "مستشفى المقاصد")] }, { error: new Error("u") }] });
    await expect(relinkWorkplaces(failing.client)).rejects.toThrow("u");
  });

  it("relinkDoctor swallows a failure, because the cron will catch up", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(relinkDoctor(scripted({ institutions: [{ error: new Error("down") }] }).client, "d1")).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
  });
});

describe("institutionUsage", () => {
  const doctor = (id: string, first: string, is_admin = false, is_visible = true) => ({ id, arabic_first_name: first, arabic_family_name: "س", is_admin, is_visible });

  it("lists doctors per institution without staff, and everyone under an unlinked name", async () => {
    const rows = [
      { doctor_id: "d1", name: "x", workplace_type: "hospital", institution_id: "i1" },
      { doctor_id: "d2", name: "x", workplace_type: "hospital", institution_id: "i1" },
      { doctor_id: "staff", name: "x", workplace_type: "hospital", institution_id: "i1" },
      { doctor_id: "d1", name: "مجهول", workplace_type: "hospital", institution_id: null },
      { doctor_id: "staff", name: "مجهول", workplace_type: "hospital", institution_id: null },
      { doctor_id: "d3", name: "عيادة", workplace_type: "clinic", institution_id: null },
      { doctor_id: "gone", name: "مجهول", workplace_type: "hospital", institution_id: null },
    ];
    const { client } = scripted({ doctor_workplaces: [{ data: rows }], doctors: [{ data: [doctor("d1", "ب"), doctor("d2", "أ"), doctor("staff", "م", true, false)] }] });
    const out = await institutionUsage(client);
    expect(out.doctors.i1.map((d) => d.name)).toEqual(["أ س", "ب س"]);
    expect(out.unmatched).toEqual([{ name: "مجهول", count: 2, doctors: expect.any(Array) }]);
    expect(out.unmatched[0].doctors.map((d) => d.id).sort()).toEqual(["d1", "staff"]);
  });

  it("orders unlinked names by how many doctors typed them, then by name", async () => {
    const rows = [
      { doctor_id: "d1", name: "ب", workplace_type: "hospital", institution_id: null },
      { doctor_id: "d1", name: "أ", workplace_type: "hospital", institution_id: null },
      { doctor_id: "d2", name: "أ", workplace_type: "hospital", institution_id: null },
    ];
    const { client } = scripted({ doctor_workplaces: [{ data: rows }], doctors: [{ data: [doctor("d1", "م"), doctor("d2", "ن")] }] });
    expect((await institutionUsage(client)).unmatched.map((u) => u.name)).toEqual(["أ", "ب"]);
  });

  it("throws when either read fails", async () => {
    await expect(institutionUsage(scripted({ doctor_workplaces: [{ error: new Error("w") }] }).client)).rejects.toThrow("w");
    const rows = [{ doctor_id: "d1", name: "x", workplace_type: "hospital", institution_id: "i1" }];
    await expect(institutionUsage(scripted({ doctor_workplaces: [{ data: rows }], doctors: [{ error: new Error("d") }] }).client)).rejects.toThrow("d");
  });

  it("reads further pages while they come back full", async () => {
    const page = Array.from({ length: 1000 }, () => ({ doctor_id: "d1", name: "x", workplace_type: "hospital", institution_id: "i1" }));
    const { client, calls } = scripted({ doctor_workplaces: [{ data: page }, { data: [] }], doctors: [{ data: [doctor("d1", "أ")] }] });
    await institutionUsage(client);
    expect(calls.filter((c) => c.method === "range")).toHaveLength(2);
  });
});
