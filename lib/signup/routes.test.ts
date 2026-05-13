// Tests 1, 3-9, 13, 14, 16, 17 — route-level unit tests with stubbed Supabase.
// Harness 1: vitest node environment, vi.mock for all I/O boundaries.
//
// Test 2 from the test plan ("Signup with MoH-verified license and institutional
// email dispatches verification email") is covered by lib/signup/email-dispatch.test.ts,
// which exercises dispatchSignupVerifyEmail end-to-end (token issuance, Resend POST,
// verify-URL in email body). Test 1 in this file verifies the verify-route inserts
// email_is_institutional:true for the same scenario. Together they fulfil Test 2.
//
// Tests 11 and 12 from the test plan (cron/sync-moh revocation sweep) are in
// lib/moh/cron.test.ts — they mock the Supabase service client and MohClient.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports of the modules-under-test.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(async () => ({ success: true, limit: 10, remaining: 9, reset: 0 })),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/moh/match", () => ({
  verifyLicense: vi.fn(),
}));

vi.mock("@/lib/signup/pre-approved", () => ({
  isPreApproved: vi.fn(),
}));

vi.mock("@/lib/signup/email-dispatch", () => ({
  dispatchSignupVerifyEmail: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentDoctor: vi.fn(),
}));

// Next.js server modules that are not available in the node test env.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Import after mocks are wired.
// ---------------------------------------------------------------------------

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifyLicense } from "@/lib/moh/match";
import { isPreApproved } from "@/lib/signup/pre-approved";
import { dispatchSignupVerifyEmail } from "@/lib/signup/email-dispatch";
import { getCurrentDoctor } from "@/lib/auth/session";

// Route handler imports (under test).
import { POST as verifyPOST } from "@/app/api/signup/verify/route";
import { POST as startPOST } from "@/app/api/signup/start/route";
import { GET as emailVerifyGET } from "@/app/api/signup/email-verify/route";
import { POST as emailStartPOST } from "@/app/api/signup/email-start/route";
import { POST as checkLicensePOST } from "@/app/api/signup/check-license/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID = "123e4567-e89b-12d3-a456-426614174001";
const UUID2 = "123e4567-e89b-12d3-a456-426614174002";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/signup/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(url: string): Request {
  return new Request(url, { method: "GET" });
}

/** Minimal pending payload for signup/verify tests. */
const PENDING_PAYLOAD = {
  phone_e164: "+972501234567",
  phone_display: "050-1234567",
  license_number: "9417",
  arabic_first_name: "نور",
  arabic_family_name: "الأمين",
  arabic_first_name_normalized: "نور",
  arabic_family_name_normalized: "الامين",
  arabic_full_name_normalized: "نور الامين",
  hebrew_first_name: "נור",
  hebrew_family_name: "אל-אמין",
  subspecialty: null,
  subspecialty_normalized: null,
  email: "dr@hadassah.org.il",
  email_domain: "hadassah.org.il",
  email_is_institutional: true,
  specialty_ids: [UUID],
  workplaces: [{ name: "Hadassah", name_normalized: "hadassah", is_primary: true, sort_order: 0 }],
  license_verification_status: "verified" as const,
};

/** Minimal start-route request body */
const START_BODY = {
  phone: "+972501234567",
  license_number: "9417",
  arabic_first_name: "نور نور",
  arabic_family_name: "الأمين",
  hebrew_first_name: "נור",
  hebrew_family_name: "אל-אמין",
  specialty_ids: [UUID],
  email: "dr@hadassah.org.il",
  main_workplace: "Hadassah Medical Center",
  consent: true as const,
};

/**
 * Builds a chainable Supabase query stub. Every unknown method returns `this`
 * for chaining; terminal methods (maybeSingle, single) return the supplied
 * row/error. `insert` and `update` return a chain supporting `.select().single()`.
 *
 * Override specific tables in the `overrides` map.
 */
function buildChainableStub(overrides: Record<string, () => unknown> = {}) {
  const insertCapture: Record<string, unknown[]> = {};

  // Build a chainable terminal that resolves when awaited.
  function terminal(result: unknown) {
    const p = Promise.resolve(result);
    // Make the object look like a promise for `await` and also support further
    // method chaining (for the .select().single() pattern on insert).
    return Object.assign(p, {
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      maybeSingle: vi.fn(async () => result),
      single: vi.fn(async () => result),
      select: vi.fn(() => ({
        maybeSingle: vi.fn(async () => result),
        single: vi.fn(async () => result),
      })),
      is: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(async () => result),
          single: vi.fn(async () => result),
        })),
      })),
    });
  }

  function tableChain(table: string) {
    if (overrides[table]) {
      return overrides[table]();
    }

    const noRow = { data: null, error: null };
    const withId = { data: { id: UUID }, error: null };

    // select chain: supports .eq, .or, .limit, .is, .maybeSingle, .single
    const selectChain = (defaultRow = noRow) => {
      const chain: Record<string, unknown> = {};
      const setChain = (result = defaultRow) => {
        chain.eq = vi.fn(() => setChain(result));
        chain.or = vi.fn(() => setChain(result));
        chain.limit = vi.fn(() => setChain(result));
        chain.is = vi.fn(() => setChain(result));
        chain.not = vi.fn(() => setChain(result));
        chain.maybeSingle = vi.fn(async () => result);
        chain.single = vi.fn(async () => result);
        return chain;
      };
      return setChain();
    };

    const insertFn = vi.fn((rows: unknown) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      insertCapture[table] = [...(insertCapture[table] ?? []), ...arr];
      return terminal(withId);
    });

    const updateFn = vi.fn(() => ({
      eq: vi.fn(() => ({
        data: null,
        error: null,
        is: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => noRow),
            single: vi.fn(async () => withId),
          })),
        })),
      })),
    }));

    const deleteFn = vi.fn(() => ({
      eq: vi.fn(async () => noRow),
    }));

    return {
      select: vi.fn(() => selectChain()),
      insert: insertFn,
      update: updateFn,
      delete: deleteFn,
      upsert: vi.fn(async () => ({ error: null })),
    };
  }

  const fromSpy = vi.fn((table: string) => tableChain(table));

  return {
    client: { from: fromSpy } as unknown as ReturnType<typeof createSupabaseServiceClient>,
    inserts: insertCapture,
    fromSpy,
  };
}

/** SSR client stub for OTP verification. */
function buildSsrStub(userId = "auth-uid-1", otpError: Error | null = null) {
  return {
    auth: {
      verifyOtp: vi.fn(async () =>
        otpError
          ? { data: { user: null }, error: otpError }
          : { data: { user: { id: userId } }, error: null },
      ),
      signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    },
  } as unknown as ReturnType<typeof createSupabaseServerClient>;
}

// ---------------------------------------------------------------------------
// Test 16 — is_admin_approved: false always inserted in signup/verify
// ---------------------------------------------------------------------------

describe("Test 16 — signup/verify always inserts is_admin_approved: false", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNUP_TOKEN_SECRET = "test-secret";
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@example.com";
    process.env.RESEND_BASE_URL = "https://example.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  });

  async function runVerifyWithStatus(
    licenseStatus: "verified" | "soft_match" | "not_found",
  ) {
    const capturedRows: Record<string, unknown>[] = [];

    const { client: service } = buildChainableStub({
      pending_signups: () => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: UUID2,
                phone_e164: "+972501234567",
                payload: { ...PENDING_PAYLOAD, license_verification_status: licenseStatus },
                expires_at: new Date(Date.now() + 900_000).toISOString(),
                attempts: 0,
              },
              error: null,
            })),
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ data: null, error: null })) }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ data: null, error: null })) }),
      }),
      doctors: () => {
        const pending = Object.assign(Promise.resolve({ data: { id: UUID }, error: null }), {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: UUID }, error: null })),
          })),
        });
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            }),
          }),
          insert: vi.fn((row: unknown) => {
            capturedRows.push(row as Record<string, unknown>);
            return pending;
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn(async () => ({ data: null, error: null })),
          }),
        };
      },
    });

    const ssr = buildSsrStub();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(ssr);

    const req = makeRequest({ signup_session_id: UUID2, otp_code: "123456" });
    await verifyPOST(req);
    return capturedRows[0];
  }

  it("inserts is_admin_approved: false when license_status is 'verified'", async () => {
    const row = await runVerifyWithStatus("verified");
    expect(row).toBeDefined();
    expect(row?.["is_admin_approved"]).toBe(false);
  });

  it("inserts is_admin_approved: false when license_status is 'soft_match'", async () => {
    const row = await runVerifyWithStatus("soft_match");
    expect(row).toBeDefined();
    expect(row?.["is_admin_approved"]).toBe(false);
  });

  it("inserts is_admin_approved: false when license_status is 'not_found' (pre-approved path)", async () => {
    const row = await runVerifyWithStatus("not_found");
    expect(row).toBeDefined();
    expect(row?.["is_admin_approved"]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 17 — signup/verify never sets is_visible; uses user_chose_visible
// ---------------------------------------------------------------------------

describe("Test 17 — signup/verify uses user_chose_visible, never is_visible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNUP_TOKEN_SECRET = "test-secret";
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@example.com";
    process.env.RESEND_BASE_URL = "https://example.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  });

  it("inserts user_chose_visible: true and has no is_visible key", async () => {
    const capturedRows: Record<string, unknown>[] = [];
    const pendingResult = Object.assign(Promise.resolve({ data: { id: UUID }, error: null }), {
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: { id: UUID }, error: null })),
      })),
    });

    const { client: service } = buildChainableStub({
      pending_signups: () => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: UUID2,
                phone_e164: "+972501234567",
                payload: PENDING_PAYLOAD,
                expires_at: new Date(Date.now() + 900_000).toISOString(),
                attempts: 0,
              },
              error: null,
            })),
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ data: null, error: null })) }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ data: null, error: null })) }),
      }),
      doctors: () => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          }),
        }),
        insert: vi.fn((row: unknown) => {
          capturedRows.push(row as Record<string, unknown>);
          return pendingResult;
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn(async () => ({ data: null, error: null })),
        }),
      }),
    });

    const ssr = buildSsrStub();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(ssr);

    const req = makeRequest({ signup_session_id: UUID2, otp_code: "123456" });
    await verifyPOST(req);

    expect(capturedRows.length).toBeGreaterThanOrEqual(1);
    const row = capturedRows[0];
    expect(row?.["user_chose_visible"]).toBe(true);
    expect("is_visible" in (row ?? {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 1 — New doctor cannot appear in search until admin approves
// ---------------------------------------------------------------------------

describe("Test 1 — New doctor signup cannot appear in search until admin approves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNUP_TOKEN_SECRET = "test-secret";
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@example.com";
    process.env.RESEND_BASE_URL = "https://example.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  });

  it("verify response includes ok:true, auto_approved:false; inserted row has is_admin_approved:false and email_is_institutional:true", async () => {
    const capturedRows: Record<string, unknown>[] = [];
    const insertResult = Object.assign(Promise.resolve({ data: { id: UUID }, error: null }), {
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: { id: UUID }, error: null })),
      })),
    });

    const { client: service } = buildChainableStub({
      pending_signups: () => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: UUID2,
                phone_e164: "+972501234567",
                payload: PENDING_PAYLOAD,
                expires_at: new Date(Date.now() + 900_000).toISOString(),
                attempts: 0,
              },
              error: null,
            })),
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ data: null, error: null })) }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ data: null, error: null })) }),
      }),
      doctors: () => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          }),
        }),
        insert: vi.fn((row: unknown) => {
          capturedRows.push(row as Record<string, unknown>);
          return insertResult;
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn(async () => ({ data: null, error: null })),
        }),
      }),
    });

    const ssr = buildSsrStub();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(ssr);

    const req = makeRequest({ signup_session_id: UUID2, otp_code: "123456" });
    const res = await verifyPOST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.auto_approved).toBe(false);
    expect(capturedRows[0]?.["is_admin_approved"]).toBe(false);
    expect(capturedRows[0]?.["email_is_institutional"]).toBe(true);
    expect(capturedRows[0]?.["user_chose_visible"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Gmail address: email_is_institutional: false
// ---------------------------------------------------------------------------

describe("Test 3 — Gmail address results in email_is_institutional: false", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNUP_TOKEN_SECRET = "test-secret";
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@example.com";
    process.env.RESEND_BASE_URL = "https://example.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  });

  it("inserts email_is_institutional:false for gmail.com email", async () => {
    const capturedRows: Record<string, unknown>[] = [];
    const gmailPayload = { ...PENDING_PAYLOAD, email: "dr@gmail.com", email_domain: "gmail.com", email_is_institutional: false };
    const insertResult = Object.assign(Promise.resolve({ data: { id: UUID }, error: null }), {
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: { id: UUID }, error: null })),
      })),
    });

    const { client: service } = buildChainableStub({
      pending_signups: () => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: UUID2,
                phone_e164: "+972501234567",
                payload: gmailPayload,
                expires_at: new Date(Date.now() + 900_000).toISOString(),
                attempts: 0,
              },
              error: null,
            })),
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ data: null, error: null })) }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ data: null, error: null })) }),
      }),
      doctors: () => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          }),
        }),
        insert: vi.fn((row: unknown) => {
          capturedRows.push(row as Record<string, unknown>);
          return insertResult;
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn(async () => ({ data: null, error: null })),
        }),
      }),
    });

    const ssr = buildSsrStub();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(ssr);

    const req = makeRequest({ signup_session_id: UUID2, otp_code: "123456" });
    const res = await verifyPOST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.email_verification_sent).toBeDefined();
    expect(capturedRows[0]?.["email_is_institutional"]).toBe(false);
    expect(capturedRows[0]?.["email_domain"]).toBe("gmail.com");
  });
});

// ---------------------------------------------------------------------------
// Test 4 — not_found license at signup/start returns 409 without OTP
// ---------------------------------------------------------------------------

describe("Test 4 — not_found license at signup/start returns 409 without sending OTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 409 and does not call signInWithOtp", async () => {
    vi.mocked(verifyLicense).mockResolvedValue({ status: "not_found", source: "none" });
    vi.mocked(isPreApproved).mockResolvedValue(false);

    // Chainable select stub that supports .or().limit().maybeSingle() pattern
    const noRow = { data: null, error: null };
    const selectStub = () => {
      const chain: Record<string, unknown> = {};
      function attachAll() {
        chain.eq = vi.fn(() => chain);
        chain.or = vi.fn(() => chain);
        chain.limit = vi.fn(() => chain);
        chain.not = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(async () => noRow);
        chain.single = vi.fn(async () => noRow);
        return chain;
      }
      return attachAll();
    };

    const pendingInserts: unknown[] = [];
    const serviceMock = {
      from: vi.fn((_table: string) => ({
        select: vi.fn(() => selectStub()),
        insert: vi.fn((rows: unknown) => {
          pendingInserts.push(rows);
          return Object.assign(Promise.resolve({ data: { id: UUID }, error: null }), {
            select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: UUID }, error: null })) })),
          });
        }),
        update: vi.fn(() => ({ eq: vi.fn(async () => noRow) })),
        delete: vi.fn(() => ({ eq: vi.fn(async () => noRow) })),
        upsert: vi.fn(async () => ({ error: null })),
      })),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceMock as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );

    const ssrStub = buildSsrStub();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(ssrStub);

    const req = makeRequest(START_BODY);
    const res = await startPOST(req);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe("license_not_in_registry");
    expect(ssrStub.auth.signInWithOtp).not.toHaveBeenCalled();
    // Filter out the audit_log insert (it's an array of audit rows, not pending_signups)
    const pendingRows = pendingInserts.filter(
      (r) => !Array.isArray(r) && typeof r === "object" && r !== null &&
        "phone_e164" in (r as Record<string, unknown>),
    );
    expect(pendingRows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Pre-approved not_found license proceeds to OTP
// ---------------------------------------------------------------------------

describe("Test 5 — Pre-approved not_found license proceeds to OTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 and calls signInWithOtp for pre-approved license", async () => {
    vi.mocked(verifyLicense).mockResolvedValue({ status: "not_found", source: "none" });
    vi.mocked(isPreApproved).mockResolvedValue(true);

    const noRow = { data: null, error: null };
    const selectStub = () => {
      const chain: Record<string, unknown> = {};
      function attachAll() {
        chain.eq = vi.fn(() => chain);
        chain.or = vi.fn(() => chain);
        chain.limit = vi.fn(() => chain);
        chain.not = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(async () => noRow);
        chain.single = vi.fn(async () => noRow);
        return chain;
      }
      return attachAll();
    };

    const serviceMock = {
      from: vi.fn((_table: string) => ({
        select: vi.fn(() => selectStub()),
        insert: vi.fn(() =>
          Object.assign(Promise.resolve({ data: { id: UUID }, error: null }), {
            select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: UUID }, error: null })) })),
          }),
        ),
        update: vi.fn(() => ({ eq: vi.fn(async () => noRow) })),
        delete: vi.fn(() => ({ eq: vi.fn(async () => noRow) })),
        upsert: vi.fn(async () => ({ error: null })),
      })),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceMock as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );

    const ssrStub = buildSsrStub();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(ssrStub);

    const req = makeRequest(START_BODY);
    const res = await startPOST(req);

    expect(res.status).toBe(200);
    expect(ssrStub.auth.signInWithOtp).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 6 — email-verify idempotency
// ---------------------------------------------------------------------------

describe("Test 6 — email-verify idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNUP_TOKEN_SECRET = "test-secret";
  });

  it("first click marks verified and writes audit", async () => {
    const { issueEmailToken } = await import("@/lib/signup/email-token");
    const token = issueEmailToken({ id: UUID, ttlMs: 60_000 });

    let updateCallCount = 0;
    let auditInsertCount = 0;

    const serviceMock = {
      from: vi.fn((table: string) => {
        if (table === "doctors") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn(async () => ({
                  data: { id: UUID, email_verified_at: null },
                  error: null,
                })),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn(async () => {
                      updateCallCount++;
                      return { data: { id: UUID }, error: null };
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "audit_logs") {
          return {
            insert: vi.fn(async () => {
              auditInsertCount++;
              return { data: null, error: null };
            }),
          };
        }
        return {};
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceMock as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );

    const req = makeGetRequest(
      `http://localhost/api/signup/email-verify?token=${encodeURIComponent(token)}`,
    );
    const res = await emailVerifyGET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("تم التحقق من بريدك");
    expect(updateCallCount).toBe(1);
    expect(auditInsertCount).toBe(1);
  });

  it("second click (already verified) is a no-op — no update, no audit", async () => {
    const { issueEmailToken } = await import("@/lib/signup/email-token");
    const token = issueEmailToken({ id: UUID, ttlMs: 60_000 });

    let updateCallCount = 0;
    let auditInsertCount = 0;

    const serviceMock = {
      from: vi.fn((table: string) => {
        if (table === "doctors") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn(async () => ({
                  data: { id: UUID, email_verified_at: "2026-05-12T00:00:00.000Z" },
                  error: null,
                })),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn(async () => {
                      updateCallCount++;
                      return { data: null, error: null };
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "audit_logs") {
          return {
            insert: vi.fn(async () => {
              auditInsertCount++;
              return { data: null, error: null };
            }),
          };
        }
        return {};
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceMock as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );

    const req = makeGetRequest(
      `http://localhost/api/signup/email-verify?token=${encodeURIComponent(token)}`,
    );
    const res = await emailVerifyGET(req);
    expect(res.status).toBe(200);
    // When already verified, update is skipped entirely (no conditional update call)
    expect(updateCallCount).toBe(0);
    expect(auditInsertCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — email-verify token errors return HTML
// ---------------------------------------------------------------------------

describe("Test 7 — email-verify returns HTML for invalid tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNUP_TOKEN_SECRET = "test-secret";
  });

  it("returns 400 HTML for garbage token", async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      {} as ReturnType<typeof createSupabaseServiceClient>,
    );
    const req = makeGetRequest("http://localhost/api/signup/email-verify?token=garbage");
    const res = await emailVerifyGET(req);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("غير صالح");
  });

  it("returns 400 HTML for expired token", async () => {
    const { issueEmailToken } = await import("@/lib/signup/email-token");
    const expired = issueEmailToken({ id: UUID, ttlMs: -1 });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      {} as ReturnType<typeof createSupabaseServiceClient>,
    );
    const req = makeGetRequest(
      `http://localhost/api/signup/email-verify?token=${encodeURIComponent(expired)}`,
    );
    const res = await emailVerifyGET(req);
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("انتهت صلاحية");
  });

  it("returns 400 HTML for tampered token", async () => {
    const { issueEmailToken } = await import("@/lib/signup/email-token");
    const good = issueEmailToken({ id: UUID, ttlMs: 60_000 });
    const [payload] = good.split(".");
    const tampered = `${payload}.invalidsig`;
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      {} as ReturnType<typeof createSupabaseServiceClient>,
    );
    const req = makeGetRequest(
      `http://localhost/api/signup/email-verify?token=${encodeURIComponent(tampered)}`,
    );
    const res = await emailVerifyGET(req);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("returns 400 HTML when no token param is provided", async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      {} as ReturnType<typeof createSupabaseServiceClient>,
    );
    const req = makeGetRequest("http://localhost/api/signup/email-verify");
    const res = await emailVerifyGET(req);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

// ---------------------------------------------------------------------------
// Test 8 — email-start resend dispatches email and updates sent_at
// ---------------------------------------------------------------------------

describe("Test 8 — email-start dispatches email to authenticated doctor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNUP_TOKEN_SECRET = "test-secret";
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@example.com";
    process.env.RESEND_BASE_URL = "https://example.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  });

  it("returns { ok:true, sent:true } and dispatches email", async () => {
    vi.mocked(getCurrentDoctor).mockResolvedValue({
      id: UUID,
      email: "dr@hadassah.org.il",
      arabic_first_name: "نور",
    } as never);

    // Capture update calls so we can assert email_verification_sent_at is set
    // (test plan Test 8, action 4: assert Supabase update set email_verification_sent_at).
    const updateFn = vi.fn().mockReturnValue({
      eq: vi.fn(async () => ({ data: null, error: null })),
    });
    const serviceMock = {
      from: vi.fn((_table: string) => ({
        update: updateFn,
      })),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceMock as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );
    vi.mocked(dispatchSignupVerifyEmail).mockResolvedValue(undefined);

    const res = await emailStartPOST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.sent).toBe(true);
    expect(dispatchSignupVerifyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ doctorId: UUID, email: "dr@hadassah.org.il" }),
    );
    // Assert that the route updated email_verification_sent_at on the doctors table.
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ email_verification_sent_at: expect.any(String) }),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 9 — email-start returns 401 for unauthenticated caller
// ---------------------------------------------------------------------------

describe("Test 9 — email-start returns 401 for unauthenticated caller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session exists", async () => {
    vi.mocked(getCurrentDoctor).mockResolvedValue(null);

    const res = await emailStartPOST();
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe("unauthenticated");
    expect(dispatchSignupVerifyEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 13 — check-license returns 409 for not_found when not pre-approved
// ---------------------------------------------------------------------------

describe("Test 13 — check-license returns 409 for not_found when not pre-approved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 409 with license_not_in_registry", async () => {
    vi.mocked(verifyLicense).mockResolvedValue({ status: "not_found", source: "none" });
    vi.mocked(isPreApproved).mockResolvedValue(false);

    const serviceMock = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          }),
        }),
      })),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceMock as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );

    const req = makeRequest({
      license_number: "9417",
      hebrew_first_name: "אחמד",
      hebrew_family_name: "אלחטיב",
    });
    const res = await checkLicensePOST(req);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe("license_not_in_registry");
    expect(json.fields?.license_number).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Test 14 — check-license passes through for pre-approved not_found license
// ---------------------------------------------------------------------------

describe("Test 14 — check-license passes through for pre-approved not_found license", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 for pre-approved not_found license", async () => {
    vi.mocked(verifyLicense).mockResolvedValue({ status: "not_found", source: "none" });
    vi.mocked(isPreApproved).mockResolvedValue(true);

    const serviceMock = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          }),
        }),
      })),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceMock as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );

    const req = makeRequest({
      license_number: "9417",
      hebrew_first_name: "אחמד",
      hebrew_family_name: "אלחטיב",
    });
    const res = await checkLicensePOST(req);

    expect(res.status).toBe(200);
  });
});
