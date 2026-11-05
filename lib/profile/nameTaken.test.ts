// A rename to the name another listed doctor has is refused; nothing else is (#247).

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { nameTakenByAnother } from "./nameTaken";

const ME = { id: "d1", arabic_first_name: "سامر", arabic_family_name: "ناصر", is_admin_approved: true };

function serviceWith(listed: { id: string; name: string }[], error: unknown = null) {
  const asked: { table: string; name?: string; not?: string }[] = [];
  const client = {
    from: (table: string) => {
      const q: { table: string; name?: string; not?: string } = { table };
      asked.push(q);
      const chain = {
        select: () => chain,
        eq: (_col: string, v: string) => ((q.name = v), chain),
        neq: (_col: string, v: string) => ((q.not = v), chain),
        limit: async () => ({ data: error ? null : listed.filter((d) => d.name === q.name && d.id !== q.not), error }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, asked };
}

describe("nameTakenByAnother", () => {
  it("refuses the name of another listed doctor, whichever half changes", async () => {
    const { client } = serviceWith([{ id: "d2", name: "سمير ناصر" }]);
    expect(await nameTakenByAnother(client, ME, { arabic_first_name: "سمير" })).toBe(true);
    const other = serviceWith([{ id: "d2", name: "سامر خوري" }]);
    expect(await nameTakenByAnother(other.client, ME, { arabic_family_name: "خوري" })).toBe(true);
  });

  it("asks the listed view, not the doctors table, and matches the way names are stored", async () => {
    const { client, asked } = serviceWith([]);
    await nameTakenByAnother(client, ME, { arabic_first_name: "سَمير" });
    expect(asked).toEqual([{ table: "listed_doctors", name: "سمير ناصر", not: "d1" }]);
  });

  it("lets through a name nobody listed has", async () => {
    const { client } = serviceWith([{ id: "d2", name: "سمير ناصر" }]);
    expect(await nameTakenByAnother(client, ME, { arabic_first_name: "كمال" })).toBe(false);
  });

  it("does not count the doctor's own name, or a save that leaves the name alone", async () => {
    const { client, asked } = serviceWith([{ id: "d2", name: "سامر ناصر" }]);
    expect(await nameTakenByAnother(client, ME, { arabic_first_name: "سامر" })).toBe(false);
    expect(await nameTakenByAnother(client, ME, {})).toBe(false);
    expect(asked).toEqual([]);
  });

  it("is for accepted doctors only: a waiting one is not listed and is looked at on acceptance", async () => {
    const { client, asked } = serviceWith([{ id: "d2", name: "سمير ناصر" }]);
    expect(await nameTakenByAnother(client, { ...ME, is_admin_approved: false }, { arabic_first_name: "سمير" })).toBe(false);
    expect(asked).toEqual([]);
  });

  it("throws when the lookup fails, so the rename is not let through unchecked", async () => {
    const { client } = serviceWith([], new Error("down"));
    await expect(nameTakenByAnother(client, ME, { arabic_first_name: "سمير" })).rejects.toThrow("down");
  });
});
