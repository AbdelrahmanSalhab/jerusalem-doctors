// POST /api/signup/start: every way it says no, and what it leaves behind.
// route.test.ts covers the happy paths against fixed fakes; here each door
// can be closed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  rateIp: true,
  ratePhone: true,
  turnstile: true,
  registry: null as { first: string; family: string } | null,
  phoneOwnerError: null as { code: string } | null,
  dupeError: null as { code: string } | null,
  insertError: null as unknown,
  otpError: null as unknown,
  deleted: [] as string[],
  inserts: [] as Record<string, unknown>[],
  stopped: [] as string[],
  sendFailures: [] as unknown[],
}));

vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async (name: string) => ({ success: name === "signupStartIp" ? s.rateIp : s.ratePhone })) }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn(async () => ({ ok: s.turnstile })) }));
vi.mock("@/lib/moh/client", () => ({ MohClient: class { async findByLicenses() { return []; } } }));
vi.mock("@/lib/otp/failure", () => ({
  recordStopped: vi.fn(async (r: string) => void s.stopped.push(r)),
  recordSendFailure: vi.fn(async (_: unknown, r: unknown) => void s.sendFailures.push(r)),
  failureReason: () => "provider_error",
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithOtp: async () => ({ error: s.otpError }) } }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      if (table === "moh_practitioners") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: s.registry && {
                  license_number: 23456,
                  hebrew_first_name: s.registry.first,
                  hebrew_family_name: s.registry.family,
                  hebrew_first_norm: s.registry.first,
                  hebrew_family_norm: s.registry.family,
                  specialty_name_he: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "usage_events") return { insert: async () => ({ error: null }) };
      if (table === "doctors") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: s.phoneOwnerError }) }),
            or: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: s.dupeError }) }) }),
          }),
        };
      }
      return {
        insert: (row: Record<string, unknown>) => {
          s.inserts.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "session-1" }, error: s.insertError }) }) };
        },
        delete: () => ({
          eq: async (_: string, id: string) => (s.deleted.push(id), { error: null }),
          lt: async () => ({ error: null }),
        }),
      };
    },
  }),
}));

const BASE = {
  phone: "0501234567",
  license_region: "IL",
  license_number: "1-23456",
  arabic_first_name: "دانيال",
  arabic_family_name: "دريفوس",
  hebrew_first_name: "דניאל",
  hebrew_family_name: "דריפוס",
  specialty_ids: ["11111111-1111-4111-8111-111111111111"],
  career_stage: "specialist",
  email: "doc@example.com",
  workplaces: [{ name: "مستشفى المقاصد", workplace_type: "hospital", is_primary: true }],
  consent: true,
  pledge: true,
};

async function start(body: Record<string, unknown> = {}) {
  const { POST } = await import("./route");
  const res = await POST(new Request("https://example.test/api/signup/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...BASE, ...body }) }));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  Object.assign(s, { rateIp: true, ratePhone: true, turnstile: true, registry: null, phoneOwnerError: null, dupeError: null, insertError: null, otpError: null });
  s.deleted.length = s.inserts.length = s.stopped.length = s.sendFailures.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/signup/start: refusals", () => {
  it("stops an address that asks too often, and counts it", async () => {
    s.rateIp = false;
    expect((await start()).status).toBe(429);
    expect(s.stopped).toEqual(["our_rate_limit"]);
  });

  it("stops a phone that asks too often", async () => {
    s.ratePhone = false;
    expect((await start()).status).toBe(429);
    expect(s.stopped).toEqual(["our_rate_limit"]);
  });

  it("refuses a failed human check", async () => {
    s.turnstile = false;
    expect(await start()).toMatchObject({ status: 403, body: { code: "turnstile_failed" } });
    expect(s.stopped).toEqual(["turnstile_failed"]);
  });

  it("names the field when the body is wrong, and answers a body that is not JSON", async () => {
    expect(await start({ arabic_first_name: "" })).toMatchObject({ status: 400, body: { code: "invalid_body" } });
    const { POST } = await import("./route");
    const res = await POST(new Request("https://example.test/x", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("refuses a phone that is not a phone, and one we cannot text", async () => {
    expect(await start({ phone: "12" })).toMatchObject({ status: 400, body: { code: "invalid_phone" } });
    expect(await start({ phone: "+14155550123" })).toMatchObject({ status: 400, body: { code: expect.stringMatching(/invalid_phone|phone_unsupported/) } });
  });

  it("names the licence field when the primary or the secondary licence cannot be read", async () => {
    const primary = await start({ license_number: "abc" });
    expect(primary).toMatchObject({ status: 400, body: { code: "invalid_license" } });
    expect(primary.body.fields).toHaveProperty("license_number");
    const secondary = await start({ license_region: "PS", license_number: "12345", secondary_license_region: "IL", secondary_license_number: "abc" });
    expect(secondary.body.fields).toHaveProperty("secondary_license_number");
  });

  it("wants the Hebrew name for an Israeli licence", async () => {
    expect(await start({ hebrew_first_name: "א" })).toMatchObject({ status: 400, body: { code: "invalid_body" } });
    expect(await start({ hebrew_family_name: undefined })).toMatchObject({ status: 400, body: { code: "invalid_body" } });
  });

  it("asks for confirmation when the Hebrew name differs from the registry, and goes on when confirmed", async () => {
    s.registry = { first: "יוסף", family: "כהן" };
    expect(await start()).toMatchObject({ status: 409, body: { code: "license_name_mismatch" } });
    expect((await start({ override_name_mismatch: true })).status).toBe(200);
    expect(s.inserts.at(-1)!.payload).toMatchObject({ license_verification_status: "name_mismatch_overridden" });
  });
});

describe("POST /api/signup/start: server failures", () => {
  it("fails when the phone or licence lookup fails for a reason other than no row", async () => {
    s.phoneOwnerError = { code: "XX000" };
    expect((await start()).status).toBe(500);
    s.phoneOwnerError = null;
    s.dupeError = { code: "XX000" };
    expect((await start()).status).toBe(500);
  });

  it("treats 'no row' from either lookup as clear", async () => {
    s.phoneOwnerError = { code: "PGRST116" };
    s.dupeError = { code: "PGRST116" };
    expect((await start()).status).toBe(200);
  });

  it("fails when the pending signup cannot be saved", async () => {
    s.insertError = { message: "disk" };
    expect((await start()).status).toBe(500);
  });

  it("rolls the pending signup back when the code cannot be sent, and counts the failure", async () => {
    s.otpError = { message: "hook failed" };
    expect(await start()).toMatchObject({ status: 502, body: { code: "otp_send_failed" } });
    expect(s.deleted).toEqual(["session-1"]);
    expect(s.sendFailures).toEqual(["provider_error"]);
  });
});

describe("POST /api/signup/start: what is stored", () => {
  it("keeps an unset career stage as null, and orders clinics with the primary first", async () => {
    const out = await start({
      career_stage: undefined,
      seeking_work: true,
      subspecialty: "قلب الأطفال",
      workplaces: [
        { name: "عيادة أ", workplace_type: "clinic", is_primary: false },
        { name: "عيادة أ", workplace_type: "clinic", is_primary: false },
        { name: "عيادة ب", workplace_type: "clinic", is_primary: true },
      ],
    });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const payload = s.inserts.at(-1)!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ career_stage: null });
    const names = (payload.workplaces as { name: string }[]).map((w) => w.name);
    expect(names).toEqual(["عيادة ب", "عيادة أ"]);
  });

  it("accepts a Palestinian licence, which goes to review without a registry check", async () => {
    const out = await start({ license_region: "PS", license_number: "12345", hebrew_first_name: undefined, hebrew_family_name: undefined });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.license_status).toBe("not_found");
  });
});
