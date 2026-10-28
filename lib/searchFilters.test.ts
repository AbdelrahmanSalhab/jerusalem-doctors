import { describe, expect, it } from "vitest";
import { activeFilterCount, NO_FILTERS, searchFromParams, searchParamsOf, setFilterParams } from "./searchFilters";

describe("search filters", () => {
  it("counts only the filters that are on", () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...NO_FILTERS, stage: "resident", seekingWork: true })).toBe(2);
  });

  it("sends only what is set", () => {
    const p = new URLSearchParams({ q: "x" });
    setFilterParams(p, { institutionId: "i1", workplaceType: "hmo", stage: "", seekingWork: true });
    expect(p.toString()).toBe("q=x&institution_id=i1&workplace_type=hmo&seeking_work=1");
    const empty = new URLSearchParams();
    setFilterParams(empty, NO_FILTERS);
    expect(empty.toString()).toBe("");
  });
});

describe("search in the URL", () => {
  const ID = "3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b";

  it("reads back what it wrote", () => {
    const search = { q: "سارة", specialtyId: ID, filters: { institutionId: ID, workplaceType: "hmo" as const, stage: "resident" as const, seekingWork: true } };
    expect(searchFromParams(searchParamsOf(search))).toEqual(search);
  });

  it("reads an empty URL as no search", () => {
    expect(searchFromParams(new URLSearchParams())).toEqual({ q: "", specialtyId: "", filters: NO_FILTERS });
  });

  it("drops what the API would refuse, instead of failing the search", () => {
    const p = new URLSearchParams({ specialty_id: "x", institution_id: "y", workplace_type: "zoo", stage: "boss", seeking_work: "yes" });
    expect(searchFromParams(p)).toEqual({ q: "", specialtyId: "", filters: NO_FILTERS });
  });

  it("trims the query and leaves unset parts out", () => {
    expect(searchParamsOf({ q: "  x  ", specialtyId: "", filters: NO_FILTERS }).toString()).toBe("q=x");
  });
});
