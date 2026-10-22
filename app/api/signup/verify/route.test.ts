// POST /api/signup/verify: the attempt counter, the OTP check, and the
// doctor row materialised from the pending payload.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth, db, jsonRequest } from "@/test/fakeSupabase";

const rateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});
vi.mock("@/lib/supabase/server", async () => {
  const { auth } = await import("@/test/fakeSupabase");
  return { createSupabaseServerClient: async () => ({ auth }) };
});

const SESSION = "11111111-1111-4111-8111-111111111111";
const BODY = { signup_session_id: SESSION, otp_code: "123456" };

function payload(overrides: Record<string, unknown> = {}) {
  return {
    phone_e164: "+972501234567",
    phone_display: "050-123-4567",
    license_number: "12345",
    license_region: "IL",
    secondary_license_region: null,
    secondary_license_number: null,
    secondary_license_verification_status: null,
    arabic_first_name: "إياس",
    arabic_family_name: "سلهب",
    arabic_first_name_normalized: "اياس",
    arabic_family_name_normalized: "سلهب",
    arabic_full_name_normalized: "اياس سلهب",
    hebrew_first_name: null,
    hebrew_family_name: null,
    subspecialty: null,
    subspecialty_normalized: null,
    email: null,
    bio: null,
    career_stage: null,
    residency_start_year: null,
    specialty_ids: ["s1", "s2"],
    workplaces: [
      { name: "عيادة", name_normalized: "عياده", workplace_type: "clinic", details: null, is_primary: true, sort_order: 0 },
    ],
    license_verification_status: "verified",
    ...overrides,
  };
}

function pending(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: SESSION,
      phone_e164: "+972501234567",
      payload: payload(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      attempts: 0,
      ...overrides,
    },
  };
}

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(jsonRequest("/api/signup/verify", body));
}

const doctorInsert = () => db.argsOf("doctors", "insert")[0]?.[0] as Record<string, unknown>;

/** The attempt counter's compare-and-set took the attempt. */
const CLAIMED = { data: [{ id: "p1" }] };

describe("POST /api/signup/verify", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    rateLimit.mockResolvedValue({ success: true });
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("creates an auto-approved doctor for a verified license", async () => {
    db.queue("pending_signups", pending(), CLAIMED);
    db.queue("doctors", { data: { id: "d1" } });
    const res = await call(BODY);
    expect(await res.json()).toEqual({ ok: true, auto_approved: true });

    expect(doctorInsert()).toMatchObject({
      auth_user_id: "u1",
      phone_e164: "+972501234567",
      is_admin_approved: true,
      is_phone_verified: true,
      consent_directory_use: true,
      // Keys absent from pre-0013 payloads get explicit defaults.
      certificates: [],
      certificates_normalized: null,
      seeking_work: false,
      retired: false,
    });
    expect(doctorInsert().license_verified_at).toEqual(expect.any(String));
    expect(db.argsOf("pending_signups", "update")).toEqual([[{ attempts: 1 }]]);
    expect(db.argsOf("doctor_specialties", "insert")[0][0]).toEqual([
      { doctor_id: "d1", specialty_id: "s1" },
      { doctor_id: "d1", specialty_id: "s2" },
    ]);
    expect(db.argsOf("doctor_workplaces", "insert")[0][0]).toEqual([
      expect.objectContaining({ doctor_id: "d1", name: "عيادة", address: null, hours: null, phone: null }),
    ]);
    expect(db.argsOf("pending_signups", "delete")).toHaveLength(1);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toMatchObject({ action: "signup_verified" });
  });

  it("queues an unverified license for admin approval", async () => {
    db.queue("pending_signups", pending({ payload: payload({ license_verification_status: "not_found", specialty_ids: [], workplaces: [] }) }), CLAIMED);
    db.queue("doctors", { data: { id: "d1" } });
    expect(await (await call(BODY)).json()).toEqual({ ok: true, auto_approved: false });
    expect(doctorInsert()).toMatchObject({ is_admin_approved: false, license_verified_at: null });
    expect(db.argsOf("doctor_specialties", "insert")).toHaveLength(0);
    expect(db.argsOf("doctor_workplaces", "insert")).toHaveLength(0);
  });

  it("stamps license_verified_at for a soft match", async () => {
    db.queue("pending_signups", pending({ payload: payload({ license_verification_status: "soft_match" }) }), CLAIMED);
    db.queue("doctors", { data: { id: "d1" } });
    await call(BODY);
    expect(doctorInsert()).toMatchObject({ is_admin_approved: false });
    expect(doctorInsert().license_verified_at).toEqual(expect.any(String));
  });

  it("keeps going when the specialty or workplace links fail", async () => {
    db.queue("pending_signups", pending(), CLAIMED);
    db.queue("doctors", { data: { id: "d1" } });
    db.queue("doctor_specialties", { error: { message: "x" } });
    db.queue("doctor_workplaces", { error: { message: "x" } });
    expect((await call(BODY)).status).toBe(200);
  });

  it("rejects an invalid body", async () => {
    expect((await call({ signup_session_id: SESSION, otp_code: "abc" })).status).toBe(400);
  });

  it("rate limits", async () => {
    rateLimit.mockResolvedValue({ success: false });
    expect((await call(BODY)).status).toBe(429);
  });

  it("answers 410 for a missing session", async () => {
    expect((await call(BODY)).status).toBe(410);
  });

  it("returns a JSON 500 on a DB error reading the session", async () => {
    db.queue("pending_signups", { error: { code: "XX000" } });
    expect((await call(BODY)).status).toBe(500);
  });

  it("answers 410 for an expired code but keeps the signup for a reminder", async () => {
    db.queue("pending_signups", pending({ expires_at: new Date(Date.now() - 1000).toISOString() }), CLAIMED);
    expect((await call(BODY)).status).toBe(410);
    expect(db.argsOf("pending_signups", "delete")).toHaveLength(0);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("burns the session after too many attempts", async () => {
    db.queue("pending_signups", pending({ attempts: 5 }), CLAIMED);
    const res = await call(BODY);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "too_many_attempts" });
    expect(db.argsOf("pending_signups", "delete")).toHaveLength(1);
  });

  it("turns away a request that lost the race for the same attempt", async () => {
    // Another request moved the counter between our read and our write.
    db.queue("pending_signups", pending(), { data: [] });
    const res = await call(BODY);
    expect(res.status).toBe(429);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(db.argsOf("pending_signups", "eq")).toContainEqual(["attempts", 0]);
  });

  it("counts the attempt even when the code is wrong", async () => {
    db.queue("pending_signups", pending({ attempts: 2 }), CLAIMED);
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    const res = await call(BODY);
    expect(res.status).toBe(400);
    expect(db.argsOf("pending_signups", "update")).toEqual([[{ attempts: 3 }]]);
    expect(db.argsOf("doctors", "insert")).toHaveLength(0);
  });

  it("maps a duplicate insert to 409", async () => {
    db.queue("pending_signups", pending(), CLAIMED);
    db.queue("doctors", { error: { code: "23505" } });
    const res = await call(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "duplicate" });
  });

  it("maps any other insert error to 500", async () => {
    db.queue("pending_signups", pending(), CLAIMED);
    db.queue("doctors", { error: { code: "XX000" } });
    expect(await (await call(BODY)).json()).toMatchObject({ code: "create_failed" });
  });
});

describe("POST /api/signup/verify: a phone that already has an account", () => {
  const EXISTING = pending({
    payload: { phone_e164: "+972501234567", existing_doctor_id: "d1" },
  });

  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    rateLimit.mockResolvedValue({ success: true });
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("signs the owner in instead of creating a second doctor", async () => {
    db.queue("pending_signups", EXISTING, CLAIMED);
    db.queue("doctors", {
      data: { id: "d1", is_active: true, is_admin_approved: true, auth_user_id: null },
    });
    const res = await call(BODY);
    expect(await res.json()).toEqual({ ok: true, auto_approved: true, existing_account: true });
    expect(db.argsOf("doctors", "insert")).toHaveLength(0);
    expect(db.argsOf("doctors", "update")).toEqual([[{ auth_user_id: "u1" }]]);
    expect(db.argsOf("pending_signups", "delete")).toHaveLength(1);
  });

  it("checks the OTP first", async () => {
    db.queue("pending_signups", EXISTING, CLAIMED);
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    const res = await call(BODY);
    expect(await res.json()).toMatchObject({ code: "invalid_otp" });
    expect(db.argsOf("doctors", "select")).toHaveLength(0);
  });

  it("refuses an inactive account", async () => {
    db.queue("pending_signups", EXISTING, CLAIMED);
    db.queue("doctors", { data: { id: "d1", is_active: false, is_admin_approved: true, auth_user_id: "u1" } });
    const res = await call(BODY);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "account_inactive" });
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("treats a doctor deleted since signup/start as an expired session", async () => {
    db.queue("pending_signups", EXISTING, CLAIMED);
    const res = await call(BODY);
    expect(res.status).toBe(410);
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("reports a failed link", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.queue("pending_signups", EXISTING, CLAIMED);
    db.queue(
      "doctors",
      { data: { id: "d1", is_active: true, is_admin_approved: false, auth_user_id: null } },
      { error: { message: "boom" } },
    );
    const res = await call(BODY);
    expect(res.status).toBe(500);
  });

  it("returns a JSON 500 when the doctor read fails", async () => {
    db.queue("pending_signups", EXISTING, CLAIMED);
    db.queue("doctors", { error: { code: "XX000", message: "boom" } });
    expect((await call(BODY)).status).toBe(500);
  });
});
