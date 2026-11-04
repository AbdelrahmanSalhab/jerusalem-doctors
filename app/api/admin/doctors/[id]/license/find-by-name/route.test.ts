// The name lookup is for admins only and writes nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ admin: true, allowed: true }));
const lookup = vi.hoisted(() => ({
  find: vi.fn(async (...args: unknown[]) => (void args, { candidates: [{ licenseNumber: "189317" }], more: false })),
}));
let doctor: Record<string, unknown> | null = null;
const writes: string[] = [];

vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull: vi.fn(async () => (gate.admin ? { id: "00000000-0000-4000-8000-00000000a001" } : null)) }));
vi.mock("@/lib/admin/findByName", () => ({ findByName: lookup.find }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: gate.allowed })) }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
        update: () => writes.push(table),
        insert: () => writes.push(table),
        maybeSingle: async () => ({ data: table === "doctors" ? doctor : null, error: null }),
      };
      for (const m of ["select", "eq", "neq", "in", "order", "limit"]) chain[m] = () => chain;
      return chain;
    },
  }),
}));

const ID = "00000000-0000-4000-8000-0000000000d1";
async function call(id = ID, body: unknown = { slot: "primary" }) {
  const { POST } = await import("./route");
  return POST(
    new Request("https://example.test/x", { method: "POST", ...(body === null ? {} : { body: JSON.stringify(body) }) }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  gate.admin = true;
  gate.allowed = true;
  writes.length = 0;
  lookup.find.mockClear();
  doctor = {
    id: ID,
    hebrew_first_name: "דניאל",
    hebrew_family_name: "דריפוס",
    license_number: "189371",
    license_region: "IL",
    secondary_license_number: "555555",
    secondary_license_region: "IL",
  };
});

describe("POST .../license/find-by-name", () => {
  it("answers 401 to a non-admin, and 429 past the limit", async () => {
    gate.admin = false;
    expect((await call()).status).toBe(401);
    gate.admin = true;
    gate.allowed = false;
    expect((await call()).status).toBe(429);
  });

  it("answers 404 for a bad id and for a doctor that does not exist", async () => {
    expect((await call("nope")).status).toBe(404);
    doctor = null;
    expect((await call()).status).toBe(404);
  });

  it("returns the candidates and writes nothing", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ has_name: true, candidates: [{ licenseNumber: "189317" }], more: false });
    expect(writes).toEqual([]);
  });

  it("measures how far off a candidate is from the slot being edited", async () => {
    await call(ID);
    expect(lookup.find.mock.calls.at(-1)?.[2]).toBe("189371");
    await call(ID, { slot: "secondary" });
    expect(lookup.find.mock.calls.at(-1)?.[2]).toBe("555555");
  });

  it("refuses a slot that does not exist, and a request with no body", async () => {
    expect((await call(ID, { slot: "third" })).status).toBe(400);
    expect((await call(ID, null)).status).toBe(400);
    expect(lookup.find).not.toHaveBeenCalled();
  });

  it("answers 500 when the lookup fails, rather than an empty list", async () => {
    lookup.find.mockRejectedValueOnce(new Error("moh_practitioners read failed: boom"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal_error" });
  });

  it("counts lookups apart from checks", async () => {
    const { rateLimit } = await import("@/lib/ratelimit");
    await call();
    expect(vi.mocked(rateLimit).mock.calls.at(-1)).toEqual(["adminLicenseCheck", expect.stringMatching(/:by-name$/)]);
  });

  it("finds nothing for a Palestinian licence, which has no registry, and does not look", async () => {
    doctor = { ...doctor, secondary_license_region: "PS" };
    expect(await (await call(ID, { slot: "secondary" })).json()).toEqual({ has_name: true, candidates: [], more: false });
    expect(lookup.find).not.toHaveBeenCalled();
  });

  it("says when there is no Hebrew name to search with, including a name that is only marks", async () => {
    doctor = { ...doctor, hebrew_first_name: null };
    expect((await (await call()).json()).has_name).toBe(false);
    doctor = { ...doctor, hebrew_first_name: "\u05B0\u05B8", hebrew_family_name: "דריפוס" };
    expect((await (await call()).json()).has_name).toBe(false);
  });
});
