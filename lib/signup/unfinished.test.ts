import { describe, expect, it } from "vitest";
import { INITIAL } from "./formState";
import { hashResumeToken, keepCutoff, newResumeToken, toFormState } from "./unfinished";

describe("toFormState", () => {
  it("restores what the doctor typed, and asks for consent again", () => {
    const form = toFormState({
      ...INITIAL,
      phone: "0521234567",
      arabic_first_name: "سارة",
      stage: "specialist",
      specialty_ids: ["a", "b"],
      seeking_work: true,
      consent: true,
      workplaces: [{ name: "المقاصد", workplace_type: "hospital", details: "", address: "", hours: "", phone: "", is_primary: true }],
    });
    expect(form).toMatchObject({ phone: "0521234567", arabic_first_name: "سارة", stage: "specialist", specialty_ids: ["a", "b"], seeking_work: true, consent: false });
    expect(form.workplaces[0].name).toBe("المقاصد");
    // Saved before clinics had a fund.
    expect(form.workplaces[0].hmo).toBe("");
  });

  it("falls back to the empty form for anything of the wrong shape", () => {
    const form = toFormState({ phone: 5, stage: "surgeon", specialty_ids: [1], workplaces: [{ name: "x" }], extra: "ignored" });
    expect(form).toEqual(INITIAL);
    expect(toFormState(null)).toEqual(INITIAL);
    expect(toFormState("nope")).toEqual(INITIAL);
  });
});

describe("resume tokens", () => {
  it("are long, unguessable and stored only as a hash", () => {
    const a = newResumeToken();
    expect(a).toMatch(/^[\w-]{32}$/);
    expect(newResumeToken()).not.toBe(a);
    expect(hashResumeToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResumeToken(a)).toBe(hashResumeToken(a));
  });

  it("keep 30 days of signups", () => {
    expect(keepCutoff(Date.parse("2026-10-31T00:00:00Z"))).toBe("2026-10-01T00:00:00.000Z");
  });
});
