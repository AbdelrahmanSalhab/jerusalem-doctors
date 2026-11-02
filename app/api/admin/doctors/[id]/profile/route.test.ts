// An admin editing a doctor's whole profile. The parts worth pinning down
// are the ones that can lock a doctor out of their own account: the phone
// moves auth.users and the doctors row together, or neither.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Saved {
  p_doctor_id: string;
  p_updates: Record<string, unknown>;
  p_specialty_ids: string[] | null;
  p_workplaces: Record<string, unknown>[] | null;
}

const saves: Saved[] = [];
const audits: Record<string, unknown>[] = [];
const authCalls: { id: string; attrs: Record<string, unknown> }[] = [];

let doctor: Record<string, unknown> | null;
/** Another doctor already holding the number the admin typed. */
let phoneHeldBy: { arabic_first_name: string; arabic_family_name: string } | null = null;
let rpcError: { code?: string; message: string } | null = null;
let authError: { status?: number; message: string } | null = null;
/** Errors for successive login updates; empty means no error. */
let authQueue: ({ status?: number; message: string } | null)[] = [];
let readError: { code: string } | null = null;
const gate = vi.hoisted(() => ({ allowed: true }));

const { requireAdminOrNull } = vi.hoisted(() => ({
  requireAdminOrNull: vi.fn(async (): Promise<{ id: string } | null> => ({
    id: "00000000-0000-4000-8000-00000000a001",
  })),
}));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: gate.allowed })) }));
// The relink is best-effort after the save and reads tables this fake does
// not model; it swallows its own errors, so stub it out of the way.
vi.mock("@/lib/institutions", () => ({ relinkDoctor: vi.fn(async () => {}), withHmoIds: async (_s: unknown, rows: unknown[]) => rows }));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: doctor, error: readError }),
          neq: () => ({ maybeSingle: async () => ({ data: phoneHeldBy, error: null }) }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        if (table === "audit_logs") audits.push(row);
        return { error: null };
      },
    }),
    rpc: async (name: string, args: Saved) => {
      expect(name).toBe("save_doctor_profile");
      saves.push(args);
      return { error: rpcError };
    },
    auth: {
      admin: {
        updateUserById: async (id: string, attrs: Record<string, unknown>) => {
          authCalls.push({ id, attrs });
          return { error: authQueue.length > 0 ? authQueue.shift()! : authError };
        },
      },
    },
  }),
}));

const BASE = {
  id: "00000000-0000-4000-8000-0000000000d1",
  auth_user_id: "auth-1",
  arabic_first_name: "ليلى",
  arabic_family_name: "الخطيب",
  hebrew_first_name: "לילא",
  hebrew_family_name: "ח'טיב",
  phone_e164: "+972501112222",
  phone_display: "050-111-2222",
  career_stage: "specialist" as const,
  seeking_work: false,
  retired: false,
};

async function call(body: unknown) {
  const { PATCH } = await import("./route");
  return PATCH(
    new Request("https://example.test/api/admin/doctors/00000000-0000-4000-8000-0000000000d1/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-0000000000d1" }) },
  );
}

beforeEach(() => {
  saves.length = 0;
  audits.length = 0;
  authCalls.length = 0;
  requireAdminOrNull.mockClear();
  doctor = { ...BASE };
  phoneHeldBy = null;
  rpcError = null;
  authError = null;
  authQueue = [];
  readError = null;
  gate.allowed = true;
});

describe("PATCH /api/admin/doctors/[id]/profile: who may call it", () => {
  it("refuses anyone who is not an admin, before reading anything", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await call({ bio: "x" })).status).toBe(401);
    expect(saves).toHaveLength(0);
  });

  it("answers 500, not 401, when the admin lookup itself fails", async () => {
    requireAdminOrNull.mockRejectedValueOnce(new Error("db down"));
    expect((await call({ bio: "x" })).status).toBe(500);
    expect(saves).toHaveLength(0);
  });

  it("treats a malformed id as not found, before any read", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("https://example.test/api/admin/doctors/abc/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: "x" }),
      }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(404);
    expect(saves).toHaveLength(0);
  });

  it("answers 404 for a doctor who is not there", async () => {
    doctor = null;
    expect((await call({ bio: "x" })).status).toBe(404);
  });
});

describe("PATCH /api/admin/doctors/[id]/profile: profile fields", () => {
  it("writes the field and its search copy, for the doctor in the path", async () => {
    expect((await call({ arabic_first_name: "ليلى سناء" })).status).toBe(200);
    expect(saves[0].p_doctor_id).toBe("00000000-0000-4000-8000-0000000000d1");
    expect(saves[0].p_updates).toMatchObject({
      arabic_first_name: "ليلى سناء",
      arabic_first_name_normalized: expect.any(String),
      arabic_full_name_normalized: expect.any(String),
    });
  });

  it("stores Hebrew names normalized, and says the licence needs another look", async () => {
    const res = await call({ hebrew_first_name: "  סָאלֵם  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hebrew_name_changed: true });
    // Niqqud and the surrounding spaces are gone: signup stores the
    // normalized form, and one column should hold one shape of the data.
    expect(saves[0].p_updates.hebrew_first_name).toBe("סאלם");
  });

  it("ignores the fields other routes own, and the one nobody owns", async () => {
    await call({ bio: "نص", is_admin: true, is_visible: false, license_number: "99999", consent_directory_use: true });
    expect(Object.keys(saves[0].p_updates)).toEqual(["bio"]);
  });

  it("keeps the workplace rules the doctor's own form has", async () => {
    const res = await call({
      workplaces: [
        { name: "هداسا", workplace_type: "hospital", is_primary: true },
        { name: "شعاري تسيدك", workplace_type: "hospital", is_primary: true },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("exactly_one_primary");
  });
});

describe("PATCH /api/admin/doctors/[id]/profile: the phone", () => {
  const NEW = "0503334444";
  const NEW_E164 = "+972503334444";

  it("leaves the login alone when the number did not change", async () => {
    await call({ phone: "+972501112222", bio: "x" });
    expect(authCalls).toHaveLength(0);
    expect(saves[0].p_updates).not.toHaveProperty("phone_e164");
  });

  it("moves auth.users before the row, and confirms the number", async () => {
    expect((await call({ phone: NEW })).status).toBe(200);
    expect(authCalls).toEqual([{ id: "auth-1", attrs: { phone: NEW_E164, phone_confirm: true } }]);
    expect(saves[0].p_updates).toMatchObject({ phone_e164: NEW_E164, phone_display: NEW });
  });

  it("refuses a number that cannot receive a code until it is confirmed", async () => {
    const res = await call({ phone: "+970599123456" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("phone_not_sms_deliverable");
    expect(authCalls).toHaveLength(0);
    expect(saves).toHaveLength(0);
  });

  it("takes it on a second, explicit press", async () => {
    expect((await call({ phone: "+970599123456", confirm_phone_risk: true })).status).toBe(200);
    expect(saves[0].p_updates.phone_e164).toBe("+970599123456");
  });

  it("rejects a malformed number before any write", async () => {
    const res = await call({ phone: "12" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_phone");
    expect(authCalls).toHaveLength(0);
  });

  it("names the doctor already holding the number", async () => {
    phoneHeldBy = { arabic_first_name: "أحمد", arabic_family_name: "سلهب" };
    const res = await call({ phone: NEW });
    expect(res.status).toBe(409);
    expect((await res.json()).fields.phone).toContain("أحمد سلهب");
    expect(authCalls).toHaveLength(0);
  });

  it("reports a number already taken inside auth, and writes nothing", async () => {
    authError = { status: 422, message: "Phone number already registered" };
    const res = await call({ phone: NEW });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("duplicate_phone");
    expect(saves).toHaveLength(0);
  });

  it("puts the login back when the row save fails afterwards", async () => {
    rpcError = { message: "boom" };
    expect((await call({ phone: NEW })).status).toBe(500);
    expect(authCalls).toEqual([
      { id: "auth-1", attrs: { phone: NEW_E164, phone_confirm: true } },
      { id: "auth-1", attrs: { phone: BASE.phone_e164, phone_confirm: true } },
    ]);
  });

  it("maps a unique violation on the row to a duplicate phone", async () => {
    rpcError = { code: "23505", message: "duplicate key" };
    const res = await call({ phone: NEW });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("duplicate_phone");
  });

  it("saves a doctor with no login account yet, and says so", async () => {
    doctor = { ...BASE, auth_user_id: null };
    const res = await call({ phone: NEW });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ warnings: ["no_login_account"] });
    expect(authCalls).toHaveLength(0);
    expect(saves[0].p_updates.phone_e164).toBe(NEW_E164);
  });

  it("never clears is_phone_verified on its own", async () => {
    await call({ phone: NEW });
    expect(saves[0].p_updates).not.toHaveProperty("is_phone_verified");
  });

  it("writes it when the admin sets it deliberately", async () => {
    await call({ is_phone_verified: false });
    expect(saves[0].p_updates).toMatchObject({ is_phone_verified: false });
  });
});

describe("PATCH /api/admin/doctors/[id]/profile: the trail", () => {
  it("records the fields and a masked phone, not the profile's contents", async () => {
    await call({ bio: "سيرة طويلة جدًا", phone: "0503334444" });
    const m = audits[0].metadata as Record<string, unknown>;
    expect(audits[0]).toMatchObject({
      action: "admin_doctor_profile_edited",
      actor_doctor_id: "00000000-0000-4000-8000-00000000a001",
      target_doctor_id: "00000000-0000-4000-8000-0000000000d1",
    });
    expect(m.fields).toContain("bio");
    expect(m).toMatchObject({
      phone_changed: true,
      phone_before: "+9725…2222",
      phone_after: "+9725…4444",
      auth_sync: "updated",
    });
    expect(JSON.stringify(m)).not.toContain("سيرة طويلة");
    expect(JSON.stringify(m)).not.toContain("972503334444");
  });
});

describe("PATCH /api/admin/doctors/[id]/profile: refusals and failures", () => {
  const NEW = "0503334444";
  const NEW_E164 = "+972503334444";
  it("stops a flood of saves", async () => {
    gate.allowed = false;
    expect((await call({ bio: "x" })).status).toBe(429);
  });

  it("names the field when the body is wrong, and refuses a body that is not JSON", async () => {
    const bad = await call({ email: "not an email" });
    expect(bad.status).toBe(400);
    expect(Object.keys((await bad.json()).fields)).toContain("email");
    const { PATCH } = await import("./route");
    const raw = await PATCH(new Request("https://example.test/x", { method: "PATCH", body: "nope" }), { params: Promise.resolve({ id: "00000000-0000-4000-8000-0000000000d1" }) });
    expect(raw.status).toBe(400);
  });

  it("answers 500 when the doctor cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    readError = { code: "XX000" };
    expect((await call({ bio: "x" })).status).toBe(500);
  });

  it("saves a valid workplace set, and a specialty set, and says how many in the trail", async () => {
    const res = await call({
      workplaces: [{ name: "هداسا", workplace_type: "hospital", is_primary: true }],
      specialty_ids: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(res.status).toBe(200);
    expect(audits[0]).toMatchObject({ metadata: { workplaces: 1, specialties: 1 } });
  });

  it("reports an auth failure that is not a taken number as 502, and writes nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    authError = { status: 500, message: "gotrue down" };
    const res = await call({ phone: NEW });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("auth_update_failed");
    expect(saves).toHaveLength(0);
  });

  it("keeps going, and tells Sentry, when even the rollback of the login fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcError = { message: "boom" };
    authQueue = [null, { message: "rollback failed" }];
    expect((await call({ phone: NEW })).status).toBe(500);
    expect(authCalls).toHaveLength(2);
  });

  it("does not touch the login on a failed save when the phone did not move", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcError = { message: "boom" };
    expect((await call({ bio: "x" })).status).toBe(500);
    expect(authCalls).toHaveLength(0);
  });

  it("accepts the Hebrew names being cleared or changed one at a time", async () => {
    await call({ hebrew_first_name: null });
    expect(saves[0].p_updates.hebrew_first_name).toBeNull();
    await call({ hebrew_family_name: "כהן" });
    expect(saves[1].p_updates).toHaveProperty("hebrew_family_name");
    expect(audits[1]).toMatchObject({ metadata: { hebrew_name_changed: true } });
    await call({ hebrew_first_name: BASE.hebrew_first_name });
    expect(audits[2].metadata).not.toHaveProperty("hebrew_name_changed");
  });

  it("keeps the doctor's phone display when the same number is retyped the same way", async () => {
    await call({ phone: BASE.phone_display });
    expect(saves[0].p_updates).not.toHaveProperty("phone_display");
  });

  it("formats a number typed as E.164 for the cards", async () => {
    await call({ phone: NEW_E164 });
    expect(saves[0].p_updates.phone_display).not.toBe(NEW_E164);
  });

  it("notes in the trail that a confirmed number cannot receive codes", async () => {
    await call({ phone: "+14155550123", confirm_phone_risk: true });
    expect(audits[0]).toMatchObject({ metadata: { phone_not_sms_deliverable: true } });
  });
});
