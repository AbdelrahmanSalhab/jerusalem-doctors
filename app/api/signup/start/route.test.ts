// POST /api/signup/start stores, and checks uniqueness on, the registry
// serial the doctor's number actually resolves to, not the literal reading.

import { beforeEach, describe, expect, it, vi } from "vitest";

const REGISTRY: Record<number, { first: string; family: string }> = {
  23456: { first: "דניאל", family: "דריפוס" },
};

const dupeFilters: string[] = [];
const pendingInserts: Record<string, unknown>[] = [];

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/moh/client", () => ({
  MohClient: class {
    async findByLicense() {
      return null;
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
      if (table === "doctors") {
        return {
          select: () => ({
            or: (filter: string) => {
              dupeFilters.push(filter);
              return {
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
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
        delete: () => ({ eq: async () => ({ error: null }) }),
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
