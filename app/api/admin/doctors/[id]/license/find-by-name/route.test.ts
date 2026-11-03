// The name lookup is for admins only and writes nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ admin: true, allowed: true }));
let doctor: Record<string, unknown> | null = null;
const writes: string[] = [];

vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull: vi.fn(async () => (gate.admin ? { id: "00000000-0000-4000-8000-00000000a001" } : null)) }));
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
      for (const m of ["select", "eq", "neq", "in", "limit"]) chain[m] = () => chain;
      return chain;
    },
  }),
}));

const ID = "00000000-0000-4000-8000-0000000000d1";
async function call(id = ID) {
  const { POST } = await import("./route");
  return POST(new Request("https://example.test/x", { method: "POST" }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  gate.admin = true;
  gate.allowed = true;
  writes.length = 0;
  doctor = { id: ID, hebrew_first_name: "דניאל", hebrew_family_name: "דריפוס", license_number: "189371" };
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
    expect(await res.json()).toEqual({ has_name: true, candidates: [] });
    expect(writes).toEqual([]);
  });

  it("says when there is no Hebrew name to search with", async () => {
    doctor = { ...doctor, hebrew_first_name: null };
    expect((await (await call()).json()).has_name).toBe(false);
  });
});
