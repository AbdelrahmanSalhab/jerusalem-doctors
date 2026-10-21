// GET /api/search: who may search, what reaches search_directory(), the
// page cap, and the usage count. What a search matches is tested against
// the real database in e2e/db/search.spec.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAfter } from "@/test/after";

const SPECIALTY = "11111111-1111-4111-8111-111111111111";
const SHAAREI = "55555555-5555-4555-8555-555555555555";

const { requireDoctor, rateLimit, rpc, recordEvent } = vi.hoisted(() => ({
  requireDoctor: vi.fn(async () => ({ id: "me" })),
  rateLimit: vi.fn(async () => ({ success: true })),
  rpc: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [], error: null })),
  recordEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("@/lib/usage", () => ({ recordEvent }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc }) }));
vi.mock("@/lib/cachedReads", () => ({
  cachedInstitutions: async () => [
    { id: SHAAREI, name_ar: "شعاري تسيدك", name_he: "שערי צדק", kind: "hospital", aliases: ["شعري"] },
  ],
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("@/test/after")).deferAfter,
}));

const doctor = (i: number) => ({ id: `d${i}`, arabic_first_name: "د", arabic_family_name: String(i) });

async function search(params: Record<string, string>, headers: Record<string, string> = {}) {
  const { GET } = await import("./route");
  const url = new URL("https://example.test/api/search");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await GET(new Request(url, { headers }));
  await runAfter();
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [], error: null });
  rateLimit.mockResolvedValue({ success: true });
});

describe("GET /api/search", () => {
  it("401s when requireDoctor refuses (no session, or a deactivated doctor)", async () => {
    requireDoctor.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    expect((await search({ q: "x" })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks the database once, with the normalised term and the institutions it names", async () => {
    await search({ q: "شعري", specialty_id: SPECIALTY });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("search_directory", {
      p_term: "شعري",
      p_specialty_id: SPECIALTY,
      p_institution_ids: [SHAAREI],
      // One past the page, to know whether more matched.
      p_limit: 51,
      p_workplace_institution: null,
      p_workplace_type: null,
      p_stage: null,
      p_seeking_work: false,
    });
  });

  it("passes the filter panel's choices", async () => {
    await search({ institution_id: SHAAREI, workplace_type: "hmo", stage: "general", seeking_work: "1" });
    expect(rpc).toHaveBeenCalledWith(
      "search_directory",
      expect.objectContaining({
        p_term: null,
        p_workplace_institution: SHAAREI,
        p_workplace_type: "hmo",
        p_stage: "general",
        p_seeking_work: true,
      }),
    );
  });

  it("400s on a filter value it does not know", async () => {
    expect((await search({ workplace_type: "spa" })).status).toBe(400);
    expect((await search({ stage: "consultant" })).status).toBe(400);
  });

  it("strips anything that could act as a LIKE wildcard", async () => {
    await search({ q: "س%ا_مر" });
    expect(rpc).toHaveBeenCalledWith("search_directory", expect.objectContaining({ p_term: "س ا مر" }));
  });

  it("lists everyone (filtered or not) when there is no text", async () => {
    await search({ specialty_id: SPECIALTY });
    expect(rpc).toHaveBeenCalledWith("search_directory", expect.objectContaining({ p_term: null, p_institution_ids: [] }));
  });

  it("answers an all-punctuation query with nothing, without a query", async () => {
    const body = await (await search({ q: "!!!" })).json();
    expect(body).toEqual({ results: [], count: 0, truncated: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a rate-limited caller", async () => {
    rateLimit.mockResolvedValueOnce({ success: false });
    expect((await search({ q: "x" })).status).toBe(429);
  });

  it("400s on a malformed specialty id", async () => {
    expect((await search({ specialty_id: "nope" })).status).toBe(400);
  });

  it("says how long the server took", async () => {
    expect((await search({ q: "x" })).headers.get("Server-Timing")).toMatch(/^search;dur=\d+$/);
  });

  it("50 matches: all returned, not truncated", async () => {
    rpc.mockResolvedValueOnce({ data: Array.from({ length: 50 }, (_, i) => doctor(i)), error: null });
    const body = await (await search({ q: "د" })).json();
    expect(body).toMatchObject({ count: 50, truncated: false });
  });

  it("51 matches: the first 50 returned, truncated", async () => {
    rpc.mockResolvedValueOnce({ data: Array.from({ length: 51 }, (_, i) => doctor(i)), error: null });
    const body = await (await search({ q: "د" })).json();
    expect(body).toMatchObject({ count: 50, truncated: true });
    expect(body.results.at(-1).id).toBe("d49");
  });

  it("reports a failed query instead of answering with no results", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await search({ q: "x" })).status).toBe(500);
  });

  it("counts a search, after answering, without its text", async () => {
    await search({ q: "قلب", specialty_id: SPECIALTY });
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), "search", {
      doctorId: "me",
      meta: { results: 0, filtered: true, specialty_id: SPECIALTY },
    });
  });

  it("does not count the production smoke test's searches", async () => {
    await search({ q: "x" }, { "x-ci-run": "https://github.com/a/b/actions/runs/1" });
    expect(recordEvent).not.toHaveBeenCalled();
  });
});
