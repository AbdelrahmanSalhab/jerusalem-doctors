// The directory's reads against a stand-in client: what is asked, and what a
// failed read leaves on the dashboard.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cardServices,
  directoryQuery,
  fetchDirectoryCounts,
  fetchFeatured,
  fetchRecent,
  toSearchHits,
} from "@/lib/directory";

/** A chain that records its calls and answers with `result` when awaited. */
function chain(result: { data?: unknown; error?: unknown }, calls: [string, unknown[]][] = []) {
  const c: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...result }).then(ok) };
  for (const m of ["select", "eq", "gte", "order", "limit"]) {
    c[m] = (...a: unknown[]) => (calls.push([m, a]), c);
  }
  return c;
}
const client = (c: unknown, rpc?: unknown) => ({ from: () => c, rpc: async () => rpc }) as unknown as SupabaseClient;

const ROW = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  arabic_first_name: "أ",
  arabic_family_name: "ب",
  phone_e164: "+972501112233",
  doctor_specialties: [{ specialty: [{ name_ar: "جلدية" }, { name_ar: "أطفال" }] }, { specialty: null }],
  doctor_workplaces: [
    { name: "ج", workplace_type: "clinic", is_primary: false, sort_order: 2, hmo: "كلاليت", institution_id: "i1" },
    { name: "ب", workplace_type: "clinic", is_primary: false, sort_order: 1, hmo: { name_ar: "مكابي" } },
    { name: "أ", workplace_type: "hospital", is_primary: true, sort_order: 9, hmo: null },
  ],
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("toSearchHits detail", () => {
  it("flattens a list-shaped specialty embed, orders workplaces, and names the fund", () => {
    const [hit] = toSearchHits([ROW()]);
    expect(hit.specialties).toEqual(["جلدية", "أطفال"]);
    expect(hit.workplaces.map((w) => w.name)).toEqual(["أ", "ب", "ج"]);
    expect(hit.workplaces.map((w) => w.hmo)).toEqual([null, "مكابي", "كلاليت"]);
    expect(hit.workplaces[2]).toMatchObject({ institution_id: "i1" });
  });

  it("survives a row with no specialties, workplaces or number", () => {
    const [hit] = toSearchHits([ROW({ doctor_specialties: null, doctor_workplaces: null, phone_e164: null, phone_display: null, email: null })]);
    expect(hit).toMatchObject({ specialties: [], workplaces: [], has_contact: false });
  });
});

describe("cardServices", () => {
  it("lists certificates for a stage doctor and nothing for a general practitioner", () => {
    expect(cardServices({ career_stage: "specialist", certificates: ["أ"] })).toEqual(["أ"]);
    expect(cardServices({ career_stage: null, certificates: ["أ"] })).toEqual([]);
  });
});

describe("directoryQuery", () => {
  it("reads the listed_doctors view and adds no conditions of its own: who is listed is written once, in the database", () => {
    const tables: string[] = [];
    const calls: [string, unknown[]][] = [];
    const c = chain({}, calls);
    directoryQuery({ from: (t: string) => (tables.push(t), c) } as unknown as SupabaseClient);
    expect(tables).toEqual(["listed_doctors"]);
    expect(calls.map(([m]) => m)).toEqual(["select"]);
  });
});

describe("fetchDirectoryCounts", () => {
  it("gives the counts, with institutions empty before its migration", async () => {
    const out = await fetchDirectoryCounts(client(null, { data: { listed: 5, by_domain: { a: 2 } }, error: null }));
    expect(out).toEqual({ listed: 5, byDomain: { a: 2 }, byInstitution: {} });
    const full = await fetchDirectoryCounts(client(null, { data: { listed: 5, by_domain: {}, by_institution: { i: 1 } }, error: null }));
    expect(full.byInstitution).toEqual({ i: 1 });
  });

  it("answers unknown on a failed read", async () => {
    expect(await fetchDirectoryCounts(client(null, { data: null, error: { message: "x" } }))).toEqual({ listed: null, byDomain: {}, byInstitution: {} });
  });
});

describe("fetchRecent", () => {
  it("reads the last week, newest first", async () => {
    const calls: [string, unknown[]][] = [];
    const out = await fetchRecent(client(chain({ data: [ROW()] }, calls)));
    expect(out).toHaveLength(1);
    expect(calls.map(([m]) => m)).toEqual(expect.arrayContaining(["gte", "order", "limit"]));
  });

  it("counts the week from when the doctor was accepted, not when they signed up", async () => {
    const calls: [string, unknown[]][] = [];
    await fetchRecent(client(chain({ data: [] }, calls)));
    expect(calls.find(([m]) => m === "gte")![1][0]).toBe("approved_at");
    expect(calls.find(([m]) => m === "order")![1][0]).toBe("approved_at");
  });

  it("shows nothing, and says why, on a failed read", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await fetchRecent(client(chain({ data: null, error: { message: "x" } })))).toEqual([]);
    expect(err).toHaveBeenCalled();
  });
});

describe("fetchFeatured", () => {
  it("returns the featured doctor and the graduates still seeking work", async () => {
    const out = await fetchFeatured(client(chain({ data: [ROW()] })));
    expect(out.doctor?.id).toBe("d1");
    expect(out.graduates).toHaveLength(1);
  });

  it("hides both sections on a failed read", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await fetchFeatured(client(chain({ data: null, error: { message: "x" } })));
    expect(out).toEqual({ doctor: null, graduates: [] });
    expect(err).toHaveBeenCalled();
  });
});
