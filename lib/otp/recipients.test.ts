import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isKnownRecipient } from "./recipients";

function fake(rows: { doctors?: boolean; pending?: boolean; error?: string }) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gt", "limit"]) {
        chain[m] = (...args: unknown[]) => {
          calls.push({ table, method: m, args });
          return chain;
        };
      }
      chain.maybeSingle = async () => {
        if (rows.error) return { data: null, error: { message: rows.error } };
        const hit = table === "doctors" ? rows.doctors : rows.pending;
        return { data: hit ? { id: "x" } : null, error: null };
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("isKnownRecipient", () => {
  it("accepts an open account or a signup that has not expired", async () => {
    expect(await isKnownRecipient(fake({ doctors: true }).client, "+972501234567")).toBe(true);
    expect(await isKnownRecipient(fake({ pending: true }).client, "+972501234567")).toBe(true);
  });

  it("refuses everyone else", async () => {
    expect(await isKnownRecipient(fake({}).client, "+972501234567")).toBe(false);
  });

  it("only counts open accounts and live signups", async () => {
    const { client, calls } = fake({});
    await isKnownRecipient(client, "+972501234567");
    expect(calls).toContainEqual({ table: "doctors", method: "eq", args: ["is_active", true] });
    expect(calls.find((c) => c.table === "pending_signups" && c.method === "gt")?.args[0]).toBe("expires_at");
  });

  it("throws rather than guessing when the database fails", async () => {
    await expect(isKnownRecipient(fake({ error: "down" }).client, "+972501234567")).rejects.toBeTruthy();
  });
});
