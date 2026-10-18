// GET /api/search finds an internist stored under a subspecialty only, both
// through the specialty filter and through a text query for الباطنية.

import { beforeEach, describe, expect, it, vi } from "vitest";

const INTERNAL = "11111111-1111-4111-8111-111111111111";
const NEPHRO = "22222222-2222-4222-8222-222222222222";
const RHEUM = "33333333-3333-4333-8333-333333333333";
const PEDS = "44444444-4444-4444-8444-444444444444";

const SPECIALTIES = [
  { id: INTERNAL, parent_id: null },
  { id: NEPHRO, parent_id: INTERNAL },
  { id: RHEUM, parent_id: INTERNAL },
  { id: PEDS, parent_id: null },
];

/** Every `.in(column, values)` the route issued, per table. */
const inCalls: { table: string; column: string; values: unknown[] }[] = [];

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentDoctor: vi.fn(async () => ({ id: "me" })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      let selected = "";
      const result = () => {
        if (table !== "specialties") return { data: [], error: null };
        // The name match (".or(name_ar...)") finds الباطنية itself; the
        // tree lookup selects parent_id and gets the whole list.
        return selected.includes("parent_id")
          ? { data: SPECIALTIES, error: null }
          : { data: [{ id: INTERNAL }], error: null };
      };
      const chain: Record<string, unknown> = {
        select(cols: string) {
          selected = cols;
          return chain;
        },
        in(column: string, values: unknown[]) {
          inCalls.push({ table, column, values });
          return chain;
        },
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      for (const m of ["eq", "or", "order", "limit"]) chain[m] = () => chain;
      return chain;
    },
  }),
}));

async function search(params: Record<string, string>) {
  const { GET } = await import("./route");
  const url = new URL("https://example.test/api/search");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return GET(new Request(url));
}

describe("GET /api/search: specialty tree", () => {
  beforeEach(() => {
    inCalls.length = 0;
  });

  it("filtering by الباطنية includes its subspecialties", async () => {
    const res = await search({ specialty_id: INTERNAL });
    expect(res.status).toBe(200);
    const filter = inCalls.find((c) => c.column === "doctor_specialties.specialty_id");
    expect(filter?.values).toEqual(expect.arrayContaining([INTERNAL, NEPHRO, RHEUM]));
    expect(filter?.values).not.toContain(PEDS);
  });

  it("filtering by a leaf specialty stays on that specialty", async () => {
    await search({ specialty_id: NEPHRO });
    const filter = inCalls.find((c) => c.column === "doctor_specialties.specialty_id");
    expect(filter?.values).toEqual([NEPHRO]);
  });

  it("a text match on الباطنية also matches doctors under its subspecialties", async () => {
    await search({ q: "باطنية" });
    const viaSpecialty = inCalls.find(
      (c) => c.table === "doctor_specialties" && c.column === "specialty_id",
    );
    expect(viaSpecialty?.values).toEqual(expect.arrayContaining([INTERNAL, NEPHRO, RHEUM]));
  });
});
