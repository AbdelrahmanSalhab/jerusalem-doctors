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

/** What the doctors query returns, and the limit it was given. */
let doctorRows: unknown[] = [];
let doctorLimit: number | undefined;
let doctorError: unknown = null;
/** doctor_specialties rows the specialty lookups get. */
let specialtyLinks: { doctor_id: string }[] = [];
/** Every select() issued on doctors. */
const doctorSelects: string[] = [];

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(async () => ({ success: true })),
}));

const { requireDoctor } = vi.hoisted(() => ({
  requireDoctor: vi.fn(async () => ({ id: "me" })),
}));
vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      let selected = "";
      const result = () => {
        if (table === "doctors") return { data: doctorError ? null : doctorRows, error: doctorError };
        if (table === "doctor_specialties") return { data: specialtyLinks, error: null };
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
          if (table === "doctors") doctorSelects.push(cols);
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
      chain.limit = (n: number) => {
        if (table === "doctors") doctorLimit = n;
        return chain;
      };
      for (const m of ["eq", "or", "order"]) chain[m] = () => chain;
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
    doctorRows = [];
    specialtyLinks = [{ doctor_id: "doc-1" }];
  });

  const specialtyFilter = () =>
    inCalls.find((c) => c.table === "doctor_specialties" && c.column === "specialty_id");

  it("filtering by الباطنية includes its subspecialties", async () => {
    const res = await search({ specialty_id: INTERNAL });
    expect(res.status).toBe(200);
    expect(specialtyFilter()?.values).toEqual(expect.arrayContaining([INTERNAL, NEPHRO, RHEUM]));
    expect(specialtyFilter()?.values).not.toContain(PEDS);
  });

  it("filtering by a leaf specialty stays on that specialty", async () => {
    await search({ specialty_id: NEPHRO });
    expect(specialtyFilter()?.values).toEqual([NEPHRO]);
  });

  it("filters by doctor id, so a card keeps its other specialties", async () => {
    await search({ specialty_id: NEPHRO });
    expect(inCalls.find((c) => c.table === "doctors")).toMatchObject({ column: "id", values: ["doc-1"] });
    expect(doctorSelects.join()).not.toContain("!inner");
  });

  it("a text match on الباطنية also matches doctors under its subspecialties", async () => {
    await search({ q: "باطنية" });
    const viaSpecialty = inCalls.find(
      (c) => c.table === "doctor_specialties" && c.column === "specialty_id",
    );
    expect(viaSpecialty?.values).toEqual(expect.arrayContaining([INTERNAL, NEPHRO, RHEUM]));
  });
});

function doctorRow(i: number) {
  return {
    id: `doc-${i}`,
    arabic_first_name: "طبيب",
    arabic_family_name: String(i),
    doctor_specialties: [],
    doctor_workplaces: [],
  };
}

describe("GET /api/search: result cap", () => {
  beforeEach(() => {
    doctorRows = [];
    doctorLimit = undefined;
  });

  it("asks for one row past the page to know whether more matched", async () => {
    await search({ q: "طبيب" });
    expect(doctorLimit).toBe(51);
  });

  it("50 matches: all returned, not truncated", async () => {
    doctorRows = Array.from({ length: 50 }, (_, i) => doctorRow(i));
    const body = await (await search({ q: "طبيب" })).json();
    expect(body.results).toHaveLength(50);
    expect(body.count).toBe(50);
    expect(body.truncated).toBe(false);
  });

  it("51 matches: first 50 returned, truncated", async () => {
    doctorRows = Array.from({ length: 51 }, (_, i) => doctorRow(i));
    const body = await (await search({ q: "طبيب" })).json();
    expect(body.results).toHaveLength(50);
    expect(body.count).toBe(50);
    expect(body.truncated).toBe(true);
  });

  it("an all-punctuation query is not truncated", async () => {
    const body = await (await search({ q: "..." })).json();
    expect(body).toEqual({ results: [], count: 0, truncated: false });
  });
});

describe("GET /api/search access", () => {
  it("401s when requireDoctor refuses (no session, or a deactivated doctor)", async () => {
    requireDoctor.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    const res = await search({ q: "x" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/search at directory scale", () => {
  beforeEach(() => {
    inCalls.length = 0;
    doctorRows = [];
    doctorError = null;
  });

  it("splits a long id list across queries instead of one huge URL", async () => {
    specialtyLinks = Array.from({ length: 400 }, (_, i) => ({ doctor_id: `doc-${i}` }));
    await search({ specialty_id: NEPHRO });
    const idQueries = inCalls.filter((c) => c.table === "doctors" && c.column === "id");
    expect(idQueries).toHaveLength(3);
    expect(Math.max(...idQueries.map((c) => c.values.length))).toBeLessThanOrEqual(150);
    expect(new Set(idQueries.flatMap((c) => c.values)).size).toBe(400);
  });

  it("merges pages without duplicates", async () => {
    specialtyLinks = Array.from({ length: 200 }, (_, i) => ({ doctor_id: `doc-${i}` }));
    doctorRows = [doctorRow(1), doctorRow(2)];
    const body = await (await search({ specialty_id: NEPHRO })).json();
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(["doc-1", "doc-2"]);
  });

  it("reports a failed query instead of answering with no results", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    doctorError = { message: "URI too long" };
    const res = await search({ q: "طبيب" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "search_failed" });
  });
});
