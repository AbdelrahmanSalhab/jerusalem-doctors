// Covers the career-stage null semantics on PATCH /api/profile. The three
// states — key absent, key explicitly null, key set — mean three different
// things to the doctors table, and getting them wrong silently re-labels
// doctors (see lib/careerStage.ts for why the column stopped being derived).

import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSpy = vi.fn();
const insertSpy = vi.fn();
let me: { id: string; career_stage: "resident" | "specialist" | null } = {
  id: "doc-1",
  career_stage: null,
};

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireDoctor: vi.fn(async () => me),
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
        insert: async (rows: unknown) => {
          insertSpy(table, rows);
          return { error: null };
        },
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

describe("PATCH /api/profile: workplaces", () => {
  beforeEach(() => {
    insertSpy.mockClear();
    me = { id: "doc-1", career_stage: null };
  });

  const workplaceInsert = () =>
    insertSpy.mock.calls.find(([table]) => table === "doctor_workplaces")?.[1] as
      | Record<string, unknown>[]
      | undefined;

  it("stores a clinic's address, hours and phone", async () => {
    const res = await call({
      workplaces: [
        {
          name: "عيادة النور",
          workplace_type: "clinic",
          address: " شارع صلاح الدين ",
          hours: "الأحد-الخميس",
          phone: "02-6271234",
          is_primary: true,
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(workplaceInsert()?.[0]).toMatchObject({
      address: "شارع صلاح الدين",
      hours: "الأحد-الخميس",
      phone: "02-6271234",
    });
  });

  it("rejects an unreadable clinic phone", async () => {
    const res = await call({
      workplaces: [
        { name: "عيادة النور", workplace_type: "clinic", phone: "12", is_primary: true },
      ],
    });
    expect(res.status).toBe(400);
  });

  // A resident rotates, so clearing every workplace is a valid save.
  it("lets a resident clear their workplaces", async () => {
    me = { id: "doc-1", career_stage: "resident" };
    const res = await call({ workplaces: [] });
    expect(res.status).toBe(200);
    expect(workplaceInsert()).toBeUndefined();
  });

  it("also honours a stage declared in the same request", async () => {
    const res = await call({ career_stage: "resident", residency_start_year: 2022, workplaces: [] });
    expect(res.status).toBe(200);
  });

  it("still requires a workplace from everyone else", async () => {
    me = { id: "doc-1", career_stage: "specialist" };
    const res = await call({ workplaces: [] });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/profile: certificates and seeking work", () => {
  beforeEach(() => {
    updateSpy.mockClear();
    me = { id: "doc-1", career_stage: null };
  });

  it("stores a طب عام doctor's certificates, trimmed and de-duplicated, with a search key", async () => {
    const res = await call({
      career_stage: null,
      certificates: [" دبلوم طب الأسرة ", "", "ACLS", "ACLS"],
    });
    expect(res.status).toBe(200);
    expect(doctorUpdate()).toMatchObject({
      certificates: ["دبلوم طب الأسرة", "ACLS"],
      certificates_normalized: "دبلوم طب الاسرة acls",
    });
  });

  it("drops certificates for any other stage", async () => {
    const res = await call({ career_stage: "specialist", certificates: ["ACLS"] });
    expect(res.status).toBe(200);
    expect(doctorUpdate()).toMatchObject({
      certificates: [],
      certificates_normalized: null,
    });
  });

  it("rejects more than 5 certificates", async () => {
    const res = await call({ certificates: ["a", "b", "c", "d", "e", "f"] });
    expect(res.status).toBe(400);
  });

  it("saves seeking_work", async () => {
    const res = await call({ seeking_work: true });
    expect(res.status).toBe(200);
    expect(doctorUpdate()).toMatchObject({ seeking_work: true });
  });
});
