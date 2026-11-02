// What a profile save writes: only the fields sent, with their search twins
// recomputed from the other half of a name when one half changed.

import { describe, expect, it } from "vitest";
import { buildProfileUpdates, buildWorkplaceRows } from "./save";

const current = { arabic_first_name: "سارة", arabic_family_name: "علي" };
const P = (over: object) => over as Parameters<typeof buildProfileUpdates>[0];

describe("buildProfileUpdates", () => {
  it("writes nothing for an empty request", () => {
    expect(buildProfileUpdates(P({}), current)).toEqual({});
  });

  it("recomputes the full-name twin from the other half when only one changed", () => {
    const first = buildProfileUpdates(P({ arabic_first_name: "ليلى" }), current);
    expect(first).toMatchObject({ arabic_first_name: "ليلى" });
    expect(first.arabic_full_name_normalized).toContain("ليلي");
    const family = buildProfileUpdates(P({ arabic_family_name: "الخطيب" }), current);
    expect(family).toMatchObject({ arabic_family_name: "الخطيب", arabic_family_name_normalized: expect.any(String) });
    expect(family.arabic_full_name_normalized).toContain("سار");
  });

  it("stores empty text as null and fills the search twin only when there is text", () => {
    expect(buildProfileUpdates(P({ subspecialty: "قلب الأطفال", bio: "نبذة" }), current)).toMatchObject({ subspecialty: "قلب الأطفال", bio: "نبذة", subspecialty_normalized: expect.any(String) });
    expect(buildProfileUpdates(P({ subspecialty: "", bio: "" }), current)).toEqual({ subspecialty: null, subspecialty_normalized: null, bio: null });
  });

  it("passes email, stage, year, certificates and the two switches through", () => {
    const out = buildProfileUpdates(P({ email: "a@b.co", career_stage: "resident", residency_start_year: 2022, certificates: ["تخطيط قلب"], seeking_work: true, retired: false }), current);
    expect(out).toMatchObject({ email: "a@b.co", career_stage: "resident", residency_start_year: 2022, certificates: ["تخطيط قلب"], seeking_work: true, retired: false });
    expect(out).toHaveProperty("certificates_normalized");
  });
});

describe("buildWorkplaceRows", () => {
  it("is an empty set when none were sent, and refuses a set without exactly one primary", () => {
    expect(buildWorkplaceRows(undefined)).toEqual({ rows: [] });
    const none = buildWorkplaceRows([{ name: "أ", workplace_type: "hospital", is_primary: false }] as never);
    expect(none).toMatchObject({ error: { code: "exactly_one_primary" } });
  });
});
