import { describe, expect, it } from "vitest";
import { INITIAL } from "./formState";
import { hashResumeToken, keepCutoff, newResumeToken, purgeUnfinished, readResumeForm, toFormState } from "./unfinished";

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
      pledge: true,
      workplaces: [{ name: "المقاصد", workplace_type: "hospital", details: "", address: "", hours: "", phone: "", is_primary: true }],
    });
    expect(form).toMatchObject({ phone: "0521234567", arabic_first_name: "سارة", stage: "specialist", specialty_ids: ["a", "b"], seeking_work: true, consent: false, pledge: false });
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

describe("readResumeForm and purgeUnfinished", () => {
  const client = (result: { data?: unknown; error?: unknown; count?: number | null }) => {
    const c: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: null, ...result }).then(ok) };
    for (const m of ["select", "eq", "gte", "lt", "delete", "maybeSingle"]) c[m] = () => c;
    return { from: () => c } as never;
  };
  const TOKEN = "a".repeat(32);

  it("returns the saved form for a known link", async () => {
    const form = await readResumeForm(client({ data: { payload: { resume_form: { phone: "0521234567" } } } }), TOKEN);
    expect(form).toMatchObject({ phone: "0521234567", consent: false });
  });

  it("returns nothing for a malformed link, an unknown one, or a signup with no saved form", async () => {
    expect(await readResumeForm(client({}), "short")).toBeNull();
    expect(await readResumeForm(client({ data: null }), TOKEN)).toBeNull();
    expect(await readResumeForm(client({ data: { payload: {} } }), TOKEN)).toBeNull();
  });

  it("throws on a failed read, so the page does not pretend the link is unknown", async () => {
    await expect(readResumeForm(client({ error: { message: "boom" } }), TOKEN)).rejects.toThrow("pending_signups read failed: boom");
  });

  it("counts what the purge deleted, and throws on a failure", async () => {
    expect(await purgeUnfinished(client({ count: 4 }))).toBe(4);
    expect(await purgeUnfinished(client({ count: null }))).toBe(0);
    await expect(purgeUnfinished(client({ error: { message: "boom" } }))).rejects.toThrow("purge failed");
  });
});

describe("toFormState with odd workplaces", () => {
  it("drops a workplace that is not an object or has a wrong type", () => {
    const wp = { name: "ج", workplace_type: "hospital", details: "", address: "", hours: "", phone: "", is_primary: true };
    const form = toFormState({ workplaces: [null, "x", { ...wp, workplace_type: "moon" }, { ...wp, hmo: "كلاليت" }] });
    expect(form.workplaces).toHaveLength(1);
    expect(form.workplaces[0].hmo).toBe("كلاليت");
  });
});
