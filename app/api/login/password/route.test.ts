// Password sign-in for devs and QA: off unless configured, allowlisted only,
// and useless without a doctors row. Every failure looks the same from
// outside, so the route cannot be used to learn who is allowlisted.

import { beforeEach, describe, expect, it, vi } from "vitest";

const audits: Record<string, unknown>[] = [];

let doctorRow: Record<string, unknown> | null = null;
let signInFails = false;
const signOut = vi.fn(async () => ({ error: null }));
const signInWithPassword = vi.fn(async ({ email }: { email: string }) =>
  signInFails ? { data: { user: null }, error: { message: "bad" } } : { data: { user: { id: `user-${email}` } }, error: null },
);

let limited = false;

vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: !limited })) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithPassword, signOut } }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: doctorRow, error: null }) }) }),
      insert: async (row: Record<string, unknown>) => {
        if (table === "audit_logs") audits.push(row);
        return { error: null };
      },
    }),
  }),
}));

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new Request("https://example.test/api/login/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify(body),
    }),
  );
}

const GOOD = { email: "dev@example.com", password: "a-long-enough-password" };

beforeEach(() => {
  vi.resetModules();
  audits.length = 0;
  signInWithPassword.mockClear();
  signOut.mockClear();
  signInFails = false;
  limited = false;
  doctorRow = { id: "d1", is_active: true, is_admin: true, is_admin_approved: true };
  process.env.DEV_LOGIN = "1";
  process.env.DEV_LOGIN_EMAILS = "dev@example.com, qa@example.com";
});

describe("the flag", () => {
  it("denies the route exists when DEV_LOGIN is unset", async () => {
    delete process.env.DEV_LOGIN;
    const res = await call(GOOD);
    expect(res.status).toBe(404);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("stays shut when the allowlist is missing, rather than letting anyone in", async () => {
    process.env.DEV_LOGIN_EMAILS = "";
    expect((await call(GOOD)).status).toBe(404);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("who gets in", () => {
  it("signs in an allowlisted address with the right password", async () => {
    const res = await call(GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("never reaches Supabase for an address that is not allowlisted", async () => {
    const res = await call({ ...GOOD, email: "stranger@example.com" });
    expect(res.status).toBe(401);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("refuses a wrong password", async () => {
    signInFails = true;
    expect((await call(GOOD)).status).toBe(401);
  });

  // The structural gate: a session is only access once a doctors row claims
  // it, so an auth user without one is turned away and the cookies dropped.
  it("refuses an auth user with no doctor row, and does not leave a session behind", async () => {
    doctorRow = null;
    expect((await call(GOOD)).status).toBe(401);
    expect(signOut).toHaveBeenCalled();
  });

  it("refuses a closed account", async () => {
    doctorRow = { id: "d1", is_active: false, is_admin: false, is_admin_approved: true };
    expect((await call(GOOD)).status).toBe(401);
    expect(signOut).toHaveBeenCalled();
  });

  // Anything that tells these apart would turn the route into a way to
  // discover which addresses are allowlisted.
  it("answers identically however it fails", async () => {
    const bodies: string[] = [];
    const statuses: number[] = [];
    for (const setup of [
      () => {
        signInFails = true;
      },
      () => {
        doctorRow = null;
      },
      () => {
        doctorRow = { id: "d1", is_active: false, is_admin: false, is_admin_approved: true };
      },
    ]) {
      beforeEachState();
      setup();
      const res = await call(GOOD);
      statuses.push(res.status);
      bodies.push(JSON.stringify(await res.json()));
    }
    beforeEachState();
    const stranger = await call({ ...GOOD, email: "stranger@example.com" });
    statuses.push(stranger.status);
    bodies.push(JSON.stringify(await stranger.json()));

    expect(new Set(statuses).size).toBe(1);
    expect(new Set(bodies).size).toBe(1);
  });

  function beforeEachState() {
    signInFails = false;
    doctorRow = { id: "d1", is_active: true, is_admin: true, is_admin_approved: true };
  }
});

describe("the record", () => {
  it("logs every password sign-in, flagging admin rights", async () => {
    await call(GOOD);
    expect(audits[0]).toMatchObject({
      action: "dev_password_login",
      actor_doctor_id: "d1",
      metadata: { email: "dev@example.com", is_admin: true },
    });
  });

  it("slows guessing down", async () => {
    limited = true;
    const res = await call(GOOD);
    expect(res.status).toBe(429);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
