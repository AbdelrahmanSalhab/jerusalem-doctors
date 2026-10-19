// Each admin page must run requireAdmin itself: Next can render a page
// without re-running the (admin) layout, so the layout's check alone would
// let any signed-in doctor read the page's data.

import { describe, expect, it, vi } from "vitest";

const { requireAdmin, from } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  from: vi.fn(),
}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ from, rpc }) }));

describe("admin pages", () => {
  it.each([
    ["doctors", () => import("./page"), { searchParams: Promise.resolve({}) }],
    ["audit", () => import("./audit/page"), { searchParams: Promise.resolve({}) }],
    ["specialties", () => import("./specialties/page"), undefined],
    ["stats", () => import("./stats/page"), undefined],
    ["institutions", () => import("./institutions/page"), undefined],
  ] as const)("%s refuses a non-admin before reading any data", async (_name, load, props) => {
    const Page = (await load()).default as (p: unknown) => Promise<unknown>;
    await expect(Page(props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
