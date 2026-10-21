import { describe, expect, it } from "vitest";
import { activeFilterCount, NO_FILTERS, setFilterParams } from "./searchFilters";

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
