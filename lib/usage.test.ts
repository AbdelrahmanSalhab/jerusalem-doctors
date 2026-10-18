import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordEvent } from "./usage";

function client(insert: (row: unknown) => Promise<{ error: unknown }>) {
  return { from: () => ({ insert }) } as unknown as SupabaseClient;
}

describe("recordEvent", () => {
  it("writes the kind, doctor and details", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    await recordEvent(client(insert), "search", { doctorId: "d1", meta: { results: 0, filtered: true } });
    expect(insert).toHaveBeenCalledWith({ kind: "search", doctor_id: "d1", meta: { results: 0, filtered: true } });
  });

  it("never throws, whatever the database does", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordEvent(client(async () => ({ error: { message: "boom" } })), "signup_started")).resolves.toBeUndefined();
    await expect(
      recordEvent(client(async () => { throw new Error("down"); }), "signup_started"),
    ).resolves.toBeUndefined();
  });
});
