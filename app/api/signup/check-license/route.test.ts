// POST /api/signup/check-license resolves the typed number against the
// registry, including the `1` prefix typed without its hyphen.

import { describe, expect, it, vi } from "vitest";

const REGISTRY: Record<number, { first: string; family: string }> = {
  23456: { first: "דניאל", family: "דריפוס" },
};

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

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
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
    }),
  }),
}));

async function check(license_number: string) {
  const { POST } = await import("./route");
  const res = await POST(
    new Request("https://example.test/api/signup/check-license", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_number,
        hebrew_first_name: "דניאל",
        hebrew_family_name: "דריפוס",
      }),
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe("POST /api/signup/check-license", () => {
  it("verifies a 5-digit serial typed with the 1 prefix and no hyphen", async () => {
    const r = await check("123456");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "verified", license_number: "23456" });
  });

  it("verifies the same license typed in Arabic-Indic digits", async () => {
    const r = await check("١٢٣٤٥٦");
    expect(r.body).toMatchObject({ status: "verified", license_number: "23456" });
  });

  it("still verifies the registry display form", async () => {
    const r = await check("1-23456");
    expect(r.body).toMatchObject({ status: "verified", license_number: "23456" });
  });

  it("reports not_found under the as-typed serial when nothing matches", async () => {
    const r = await check("777777");
    expect(r.body).toMatchObject({ status: "not_found", license_number: "777777" });
  });

  it("rejects a non-physician profession code", async () => {
    const r = await check("2-45678");
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: "invalid_license" });
  });
});
