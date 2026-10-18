import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Record<string, unknown>[] = [];

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1" })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      update(values: Record<string, unknown>) {
        updates.push(values);
        return { eq: async () => ({ error: null }) };
      },
      insert: async () => ({ error: null }),
    }),
  }),
}));

async function call(body: unknown) {
  const { PATCH } = await import("./route");
  return PATCH(
    new Request("https://example.test/api/admin/doctors/d1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "d1" }) },
  );
}

describe("PATCH /api/admin/doctors/[id]: featured", () => {
  beforeEach(() => {
    updates.length = 0;
  });

  it("stamps featured_at when featuring", async () => {
    expect((await call({ featured: "graduate" })).status).toBe(200);
    expect(updates[0]).toMatchObject({ featured: "graduate" });
    expect(typeof updates[0].featured_at).toBe("string");
  });

  it("clears featured_at when unfeaturing", async () => {
    expect((await call({ featured: null })).status).toBe(200);
    expect(updates[0]).toEqual({ featured: null, featured_at: null });
  });

  it("leaves featured_at alone for other fields", async () => {
    expect((await call({ is_active: false })).status).toBe(200);
    expect(updates[0]).toEqual({ is_active: false });
  });

  it("rejects an unknown kind", async () => {
    expect((await call({ featured: "vip" })).status).toBe(400);
  });
});
