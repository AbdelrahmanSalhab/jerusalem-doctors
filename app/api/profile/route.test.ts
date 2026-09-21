// Covers the career-stage null semantics on PATCH /api/profile. The three
// states — key absent, key explicitly null, key set — mean three different
// things to the doctors table, and getting them wrong silently re-labels
// doctors (see lib/careerStage.ts for why the column stopped being derived).

import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSpy = vi.fn();

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireDoctor: vi.fn(async () => ({ id: "doc-1" })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      const chain = {
        update(values: Record<string, unknown>) {
          updateSpy(table, values);
          return chain;
        },
        eq: async () => ({ error: null }),
        delete: () => chain,
        insert: async () => ({ error: null }),
      };
      return chain;
    },
  }),
}));

function patch(body: unknown): Request {
  return new Request("https://example.test/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function call(body: unknown) {
  const { PATCH } = await import("./route");
  return PATCH(patch(body));
}

/** The values handed to doctors.update(), or null if it was never called. */
function doctorUpdate(): Record<string, unknown> | null {
  const call = updateSpy.mock.calls.find(([table]) => table === "doctors");
  return call ? (call[1] as Record<string, unknown>) : null;
}

describe("PATCH /api/profile — career stage", () => {
  beforeEach(() => {
    updateSpy.mockClear();
  });

  it("writes an explicit NULL for طب عام", async () => {
    const res = await call({ career_stage: null, residency_start_year: null });
    expect(res.status).toBe(200);
    expect(doctorUpdate()).toMatchObject({
      career_stage: null,
      residency_start_year: null,
    });
  });

  // The guard that stops an unrelated save from labelling a doctor who has
  // never declared a stage — /profile omits both keys in that case.
  it("leaves the column alone when the key is absent", async () => {
    const res = await call({ bio: "نص" });
    expect(res.status).toBe(200);
    const updates = doctorUpdate();
    expect(updates).not.toBeNull();
    expect(updates).not.toHaveProperty("career_stage");
    expect(updates).not.toHaveProperty("residency_start_year");
  });

  it("stores a declared resident with their start year", async () => {
    await call({ career_stage: "resident", residency_start_year: 2022 });
    expect(doctorUpdate()).toMatchObject({
      career_stage: "resident",
      residency_start_year: 2022,
    });
  });

  // Validation is UI-only by design: the combinations a form discourages are
  // still accepted here, so an admin or an odd case is never blocked.
  it("accepts a resident with a عيادة workplace", async () => {
    const res = await call({
      career_stage: "resident",
      residency_start_year: 2022,
      workplaces: [
        { name: "عيادة الشيخ جراح", workplace_type: "clinic", is_primary: true },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("accepts the صندوق مرضى workplace type", async () => {
    const res = await call({
      workplaces: [
        { name: "كلاليت بيت حنينا", workplace_type: "hmo", is_primary: true },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("still rejects an out-of-range year", async () => {
    const res = await call({ career_stage: "resident", residency_start_year: 1800 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_body" });
  });

  it("still rejects an unknown career stage", async () => {
    const res = await call({ career_stage: "attending" });
    expect(res.status).toBe(400);
  });
});
