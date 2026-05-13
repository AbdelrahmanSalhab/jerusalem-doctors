import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPreApproved } from "./pre-approved";

function fakeClient(matched: boolean) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: matched ? { license_number: "1" } : null,
            error: null,
          })),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
}

describe("isPreApproved", () => {
  it("returns true when a row exists", async () => {
    expect(await isPreApproved(fakeClient(true), "12345")).toBe(true);
  });

  it("returns false when no row exists", async () => {
    expect(await isPreApproved(fakeClient(false), "12345")).toBe(false);
  });
});
