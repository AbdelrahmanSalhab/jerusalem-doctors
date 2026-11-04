// POST /api/signup/check-license resolves the typed number against the
// registry, including the `1` prefix typed without its hyphen.

import { beforeEach, describe, expect, it, vi } from "vitest";

const REGISTRY: Record<number, { first: string; family: string }> = {
  23456: { first: "דניאל", family: "דריפוס" },
};

const gate = vi.hoisted(() => ({ allowed: true, human: true, registryError: false }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(async () => ({ success: gate.allowed })),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn(async () => ({ ok: gate.human })),
}));

vi.mock("@/lib/moh/client", () => ({
  MohClient: class {
    async findByLicenses() {
      return [];
    }
  },
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, license: number) => ({
          maybeSingle: async () => {
            if (gate.registryError) return { data: null, error: { code: "XX000", message: "down" } };
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

async function check(license_number: string, names = { first: "דניאל", family: "דריפוס" }) {
  const { POST } = await import("./route");
  const res = await POST(
    new Request("https://example.test/api/signup/check-license", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_number,
        hebrew_first_name: names.first,
        hebrew_family_name: names.family,
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

  it("shows the registry's spelling only for a near match, never for a name that does not match (#16)", async () => {
    const near = await check("123456", { first: "דניל", family: "דריפוס" });
    expect(near.body).toMatchObject({ status: "soft_match", registry_first_name: "דניאל", registry_family_name: "דריפוס" });
    const wrong = await check("123456", { first: "משה", family: "כהן" });
    expect(wrong.body.status).toBe("name_mismatch");
    // Otherwise it tells anyone the right name for any number.
    expect(JSON.stringify(wrong.body)).not.toContain("דניאל");
    expect(wrong.body).not.toHaveProperty("registry_first_name");
    const verified = await check("123456");
    expect(verified.body).not.toHaveProperty("registry_first_name");
  });

  it("rejects a non-physician profession code", async () => {
    const r = await check("2-45678");
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: "invalid_license" });
  });
});

describe("POST /api/signup/check-license: refusals and failures", () => {
  beforeEach(() => {
    gate.allowed = true;
    gate.human = true;
    gate.registryError = false;
  });

  it("stops a flood from one address, and a failed human check", async () => {
    gate.allowed = false;
    expect((await check("123456")).status).toBe(429);
    gate.allowed = true;
    gate.human = false;
    const r = await check("123456");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("turnstile_failed");
  });

  it("refuses a body that is not JSON or lacks the names", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("https://example.test/x", { method: "POST", body: "nope" }));
    expect(res.status).toBe(400);
  });

  it("says the registry is unavailable rather than guessing, when the lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    gate.registryError = true;
    const r = await check("123456");
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("moh_unavailable");
  });
});
