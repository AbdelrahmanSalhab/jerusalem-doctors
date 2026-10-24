// Covers the career-stage null semantics on PATCH /api/profile. The three
// states, key absent, key explicitly null, key set, mean three different
// things to the doctors table, and getting them wrong silently re-labels
// doctors (see lib/careerStage.ts for why the column stopped being derived).

import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSpy = vi.fn();
const insertSpy = vi.fn();
let me: {
  id: string;
  career_stage: "resident" | "specialist" | null;
  seeking_work?: boolean;
  retired?: boolean;
} = {
  id: "doc-1",
  career_stage: null,
};

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireDoctor: vi.fn(async () => me),
}));

/** Every save_doctor_profile call, and the error the next one returns. */
const rpcSpy = vi.fn();
let rpcError: unknown = null;

// The route saves through one save_doctor_profile call (0014). The spies
// split it back into what lands in each table, as the function does.
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    async rpc(name: string, args: Record<string, unknown>) {
      rpcSpy(name, args);
      const updates = args.p_updates as Record<string, unknown>;
      if (Object.keys(updates).length > 0) updateSpy("doctors", updates);
      if (args.p_specialty_ids !== null) insertSpy("doctor_specialties", args.p_specialty_ids);
      if (args.p_workplaces !== null) insertSpy("doctor_workplaces", args.p_workplaces);
      return { error: rpcError };
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

describe("PATCH /api/profile, career stage", () => {
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
  // never declared a stage, /profile omits both keys in that case.
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
    // An empty list, not null: the save clears them and inserts none.
    expect(workplaceInsert()).toEqual([]);
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

  it("lets a doctor looking for work clear their workplaces", async () => {
    me = { id: "doc-1", career_stage: "specialist", seeking_work: true };
    expect((await call({ workplaces: [] })).status).toBe(200);
    me = { id: "doc-1", career_stage: "specialist", seeking_work: false };
    expect((await call({ seeking_work: true, workplaces: [] })).status).toBe(200);
    me = { id: "doc-1", career_stage: "specialist", seeking_work: true };
    expect((await call({ seeking_work: false, workplaces: [] })).status).toBe(400);
  });

  it("refuses a resident who is retired, whichever half the request brings", async () => {
    me = { id: "doc-1", career_stage: "specialist", retired: true };
    const res = await call({ career_stage: "resident", residency_start_year: 2022 });
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toEqual({ retired: "لا يمكن أن تكون طبيبًا مقيمًا ومتقاعدًا معًا." });
    me = { id: "doc-1", career_stage: "resident", retired: false };
    expect((await call({ retired: true })).status).toBe(400);
    // Undoing a stored pair is allowed.
    me = { id: "doc-1", career_stage: "resident", retired: true };
    expect((await call({ retired: false })).status).toBe(200);
  });

  it("lets a retired doctor clear their workplaces", async () => {
    me = { id: "doc-1", career_stage: "specialist", retired: true };
    expect((await call({ workplaces: [] })).status).toBe(200);
    me = { id: "doc-1", career_stage: "specialist", retired: false };
    expect((await call({ retired: true, workplaces: [] })).status).toBe(200);
    me = { id: "doc-1", career_stage: "specialist", retired: true };
    expect((await call({ retired: false, workplaces: [] })).status).toBe(400);
  });

  it("keeps the workplace optional while either flag survives the save", async () => {
    me = { id: "doc-1", career_stage: "specialist", seeking_work: true, retired: true };
    expect((await call({ retired: false, workplaces: [] })).status).toBe(200);
    expect((await call({ seeking_work: false, workplaces: [] })).status).toBe(200);
    expect(
      (await call({ seeking_work: false, retired: false, workplaces: [] })).status,
    ).toBe(400);
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

  it("keeps a specialist's services, searchable", async () => {
    const res = await call({ career_stage: "specialist", certificates: ["تنظير القولون", "حقن العين"] });
    expect(res.status).toBe(200);
    expect(doctorUpdate()).toMatchObject({
      certificates: ["تنظير القولون", "حقن العين"],
      certificates_normalized: "تنظير القولون حقن العين",
    });
  });

  it("rejects more than 10 services", async () => {
    const res = await call({ certificates: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"] });
    expect(res.status).toBe(400);
  });

  it("saves seeking_work", async () => {
    const res = await call({ seeking_work: true });
    expect(res.status).toBe(200);
    expect(doctorUpdate()).toMatchObject({ seeking_work: true });
  });

  it("saves retired", async () => {
    const res = await call({ retired: true });
    expect(res.status).toBe(200);
    expect(doctorUpdate()).toMatchObject({ retired: true });
  });

  it("leaves retired alone when the key is absent", async () => {
    expect((await call({ bio: "نبذة" })).status).toBe(200);
    expect(doctorUpdate()).not.toHaveProperty("retired");
  });
});

describe("PATCH /api/profile: one transaction", () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    rpcError = null;
  });

  it("saves row, specialties and workplaces in a single call", async () => {
    const res = await call({
      bio: "نص",
      specialty_ids: ["11111111-1111-4111-8111-111111111111"],
      workplaces: [{ name: "مستشفى المقاصد", workplace_type: "hospital", is_primary: true }],
    });
    expect(res.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy.mock.calls[0][0]).toBe("save_doctor_profile");
    expect(rpcSpy.mock.calls[0][1]).toMatchObject({
      p_doctor_id: "doc-1",
      p_specialty_ids: ["11111111-1111-4111-8111-111111111111"],
    });
  });

  it("leaves untouched lists out (null), so they are kept", async () => {
    await call({ bio: "نص" });
    expect(rpcSpy.mock.calls[0][1]).toMatchObject({ p_specialty_ids: null, p_workplaces: null });
  });

  it("rejects two primary workplaces before writing anything", async () => {
    const res = await call({
      bio: "نص",
      workplaces: [
        { name: "أ", workplace_type: "hospital", is_primary: true },
        { name: "ب", workplace_type: "hospital", is_primary: true },
      ],
    });
    expect(res.status).toBe(400);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("reports a failed save", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcError = { message: "boom" };
    const res = await call({ bio: "نص" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "update_failed" });
  });

  it("keeps the primary when another workplace has the same name", async () => {
    await call({
      workplaces: [
        { name: "مستشفى المقاصد", workplace_type: "hospital", is_primary: false },
        { name: "مستشفى المقاصد", workplace_type: "hospital", is_primary: true },
      ],
    });
    const rows = rpcSpy.mock.calls[0][1].p_workplaces as { is_primary: boolean }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].is_primary).toBe(true);
  });

  it("dedupes specialty ids", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    await call({ specialty_ids: [id, id] });
    expect(rpcSpy.mock.calls[0][1].p_specialty_ids).toEqual([id]);
  });
});
