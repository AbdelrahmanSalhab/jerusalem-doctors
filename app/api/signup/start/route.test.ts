// POST /api/signup/start stores, and checks uniqueness on, the registry
// serial the doctor's number actually resolves to, not the literal reading.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REGISTRY: Record<number, { first: string; family: string }> = {
  23456: { first: "דניאל", family: "דריפוס" },
};

const dupeFilters: string[] = [];
const pendingInserts: Record<string, unknown>[] = [];
/** The doctor already holding the signup's phone, if any. */
let phoneOwner: { id: string } | null = null;
/** The doctor already holding the signup's license, if any. */
let licenseHolder: { id: string } | null = null;
const purges: [string, string][] = [];
let purgeError: unknown = null;

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/moh/client", () => ({
  MohClient: class {
    async findByLicenses() {
      return [];
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithOtp: async () => ({ error: null }) },
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      if (table === "moh_practitioners") return mohMirror();
      if (table === "usage_events") return { insert: async () => ({ error: null }) };
      if (table === "doctors") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: phoneOwner, error: null }),
            }),
            or: (filter: string) => {
              dupeFilters.push(filter);
              return {
                limit: () => ({
                  maybeSingle: async () => ({ data: licenseHolder, error: null }),
                }),
              };
            },
          }),
        };
      }
      // pending_signups
      return {
        insert: (row: Record<string, unknown>) => {
          pendingInserts.push(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: "session-1" }, error: null }),
            }),
          };
        },
        delete: () => ({
          eq: async () => ({ error: null }),
          lt: async (col: string, value: string) => {
            purges.push([col, value]);
            return { error: purgeError };
          },
        }),
      };
    },
  }),
}));

function mohMirror() {
  return {
    select: () => ({
      eq: (_col: string, license: number) => ({
        maybeSingle: async () => {
          const hit = REGISTRY[license];
          return {
            data: hit && {
              license_number: license,
              hebrew_first_name: hit.first,
              hebrew_family_name: hit.family,
              hebrew_first_norm: hit.first,
              hebrew_family_norm: hit.family,
              specialty_name_he: null,
            },
            error: null,
          };
        },
      }),
    }),
  };
}

const BASE = {
  phone: "0501234567",
  license_region: "IL",
  arabic_first_name: "دانيال",
  arabic_family_name: "دريفوس",
  hebrew_first_name: "דניאל",
  hebrew_family_name: "דריפוס",
  specialty_ids: ["11111111-1111-4111-8111-111111111111"],
  career_stage: "specialist",
  email: "doc@example.com",
  workplaces: [{ name: "مستشفى المقاصد", workplace_type: "hospital", is_primary: true }],
  consent: true,
};

async function start(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const res = await POST(
    new Request("https://example.test/api/signup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...BASE, ...body }),
    }),
  );
  return { status: res.status, body: await res.json() };
}

function storedPayload(): Record<string, unknown> {
  return pendingInserts.at(-1)!.payload as Record<string, unknown>;
}

describe("POST /api/signup/start: license resolution", () => {
  beforeEach(() => {
    dupeFilters.length = 0;
    pendingInserts.length = 0;
    phoneOwner = null;
  });

  it("stores the serial that verified, not the literal reading", async () => {
    const r = await start({ license_number: "123456" });
    expect(r.status).toBe(200);
    expect(storedPayload()).toMatchObject({
      license_number: "23456",
      license_verification_status: "verified",
    });
  });

  it("checks uniqueness against the resolved serial", async () => {
    await start({ license_number: "123456" });
    expect(dupeFilters.at(-1)).toContain("license_number.eq.23456");
    expect(dupeFilters.at(-1)).not.toContain("license_number.eq.123456");
  });

  it("accepts Arabic-Indic digits in the license", async () => {
    const r = await start({ license_number: "١-٢٣٤٥٦" });
    expect(r.status).toBe(200);
    expect(storedPayload()).toMatchObject({ license_number: "23456" });
  });

  it("resolves an IL secondary license the same way", async () => {
    const r = await start({
      license_region: "PS",
      license_number: "PS-778",
      secondary_license_region: "IL",
      secondary_license_number: "123456",
    });
    expect(r.status).toBe(200);
    expect(storedPayload()).toMatchObject({
      secondary_license_number: "23456",
      secondary_license_verification_status: "verified",
    });
  });
});

describe("POST /api/signup/start: workplaces", () => {
  beforeEach(() => {
    pendingInserts.length = 0;
  });

  it("lets a resident sign up without a workplace", async () => {
    const r = await start({
      license_number: "23456",
      career_stage: "resident",
      residency_start_year: 2023,
      workplaces: [],
    });
    expect(r.status).toBe(200);
    expect(storedPayload()).toMatchObject({ workplaces: [] });
  });

  it("still requires a workplace from a specialist", async () => {
    const r = await start({ license_number: "23456", workplaces: [] });
    expect(r.status).toBe(400);
  });

  it("lets a doctor looking for work sign up without a workplace", async () => {
    const r = await start({ license_number: "23456", seeking_work: true, workplaces: [] });
    expect(r.status).toBe(200);
  });

  it("lets a retired doctor sign up without a workplace", async () => {
    const r = await start({ license_number: "23456", retired: true, workplaces: [] });
    expect(r.status).toBe(200);
  });

  it("carries a clinic's address, hours and phone into the pending row", async () => {
    const r = await start({
      license_number: "23456",
      workplaces: [
        {
          name: "عيادة النور",
          workplace_type: "clinic",
          address: "شارع صلاح الدين",
          hours: "",
          phone: "٠٢-٦٢٧١٢٣٤",
          is_primary: true,
        },
      ],
    });
    expect(r.status).toBe(200);
    expect((storedPayload().workplaces as unknown[])[0]).toMatchObject({
      address: "شارع صلاح الدين",
      hours: null,
      phone: "02-6271234",
    });
  });
});

describe("POST /api/signup/start: a phone that already has an account", () => {
  beforeEach(() => {
    dupeFilters.length = 0;
    pendingInserts.length = 0;
    phoneOwner = { id: "doc-1" };
  });

  afterEach(() => vi.useRealTimers());

  it("answers exactly like a new signup and stores a login-only pending row", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-18T12:00:00Z"), toFake: ["Date"] });
    const existing = await start({ license_number: "123456" });
    phoneOwner = null;
    const fresh = await start({ license_number: "123456" });

    expect(existing).toEqual(fresh);
    expect(pendingInserts[0].payload).toEqual({
      phone_e164: "+972501234567",
      existing_doctor_id: "doc-1",
    });
  });

  it("answers the owner's own license exactly like an unregistered phone does", async () => {
    licenseHolder = { id: "doc-1" };
    const existing = await start({ license_number: "123456" });
    phoneOwner = null;
    const fresh = await start({ license_number: "123456" });
    licenseHolder = null;
    expect(existing.status).toBe(409);
    expect(existing).toEqual(fresh);
  });

  it("answers another doctor's license exactly like an unregistered phone does", async () => {
    licenseHolder = { id: "doc-2" };
    const existing = await start({ license_number: "123456" });
    phoneOwner = null;
    const fresh = await start({ license_number: "123456" });
    licenseHolder = null;
    expect(existing.status).toBe(409);
    expect(existing).toEqual(fresh);
  });

  it("answers an invalid workplace set exactly like an unregistered phone does", async () => {
    const workplaces = [
      { name: "مستشفى أ", workplace_type: "hospital", is_primary: true },
      { name: "مستشفى ب", workplace_type: "hospital", is_primary: true },
    ];
    const existing = await start({ license_number: "123456", workplaces });
    phoneOwner = null;
    const fresh = await start({ license_number: "123456", workplaces });
    expect(existing.status).toBe(400);
    expect(existing).toEqual(fresh);
  });
});

describe("POST /api/signup/start: emergency switch", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses with 503 before sending anything", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_AUTH_DISABLED", "1");
    pendingInserts.length = 0;
    const r = await start({ license_number: "23456" });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("phone_auth_disabled");
    expect(pendingInserts).toHaveLength(0);
  });
});

describe("POST /api/signup/start: expired pending rows", () => {
  beforeEach(() => {
    purges.length = 0;
    purgeError = null;
  });

  it("purges pending signups that have already expired", async () => {
    const before = Date.now();
    const r = await start({ license_number: "23456" });
    expect(r.status).toBe(200);
    expect(purges).toHaveLength(1);
    const [col, cutoff] = purges[0];
    expect(col).toBe("expires_at");
    expect(Date.parse(cutoff)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(cutoff)).toBeLessThanOrEqual(Date.now());
  });

  it("still starts the signup when the purge fails", async () => {
    purgeError = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await start({ license_number: "23456" });
    expect(r.status).toBe(200);
    expect(r.body.signup_session_id).toBe("session-1");
  });
});
