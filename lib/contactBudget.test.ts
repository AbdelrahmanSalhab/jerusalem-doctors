// The daily budget of distinct doctors an account may reveal (#16).

import { describe, expect, it } from "vitest";
import { countReveal, RECENT_DAYS, REVEAL_BUDGET, revealLimit } from "./contactBudget";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-10T12:00:00Z");

describe("revealLimit", () => {
  it("gives a recently accepted account the smaller budget, an older one the larger", () => {
    expect(revealLimit(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe(REVEAL_BUDGET.recent);
    expect(revealLimit(new Date(NOW - RECENT_DAYS * DAY).toISOString(), NOW)).toBe(REVEAL_BUDGET.established);
  });

  it("gives the smaller one when the acceptance time is unknown", () => {
    expect(revealLimit(null, NOW)).toBe(REVEAL_BUDGET.recent);
    expect(revealLimit("not a date", NOW)).toBe(REVEAL_BUDGET.recent);
  });
});

describe("countReveal", () => {
  const day = new Date(NOW);

  it("allows different doctors up to the limit, then refuses the next", async () => {
    const viewer = "viewer-a";
    for (let i = 1; i <= 3; i++) expect((await countReveal(viewer, `t${i}`, 3, day)).allowed).toBe(true);
    const over = await countReveal(viewer, "t4", 3, day);
    expect(over).toEqual({ allowed: false, used: 3, limit: 3 });
  });

  it("does not charge twice for the same doctor, even at the limit", async () => {
    const viewer = "viewer-b";
    await countReveal(viewer, "t1", 1, day);
    expect(await countReveal(viewer, "t1", 1, day)).toEqual({ allowed: true, used: 1, limit: 1 });
  });

  it("counts each account and each day on its own", async () => {
    await countReveal("viewer-c", "t1", 1, day);
    expect((await countReveal("viewer-d", "t1", 1, day)).allowed).toBe(true);
    expect((await countReveal("viewer-c", "t2", 1, new Date(NOW + DAY))).allowed).toBe(true);
  });

  it("keeps a refused doctor out of the count", async () => {
    const viewer = "viewer-e";
    await countReveal(viewer, "t1", 1, day);
    await countReveal(viewer, "t2", 1, day);
    expect(await countReveal(viewer, "t2", 1, day)).toMatchObject({ allowed: false });
  });
});
