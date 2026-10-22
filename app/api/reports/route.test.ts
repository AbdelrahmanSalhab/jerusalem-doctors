// Reporting a profile: from a card (signed-in doctor) or the public form.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const { requireDoctor, rateLimit, verifyTurnstile, raiseAlert } = vi.hoisted(() => ({
  requireDoctor: vi.fn(),
  rateLimit: vi.fn(async () => ({ success: true })),
  verifyTurnstile: vi.fn(async () => ({ ok: true })),
  raiseAlert: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile }));
vi.mock("@/lib/alerts", () => ({ raiseAlert }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const ME = "00000000-0000-4000-8000-0000000000a1";
const TARGET = "00000000-0000-4000-8000-0000000000b2";

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  requireDoctor.mockResolvedValue({ id: ME });
});

describe("POST /api/reports (a card)", () => {
  const call = async (body: unknown) => (await import("./route")).POST(jsonRequest("/api/reports", body));

  it("files the report, logs it and alerts the admins", async () => {
    db.queue("profile_reports", { data: { id: "r1" } });
    const res = await call({ target_doctor_id: TARGET, details: "ليس الطبيب الحقيقي" });
    expect(res.status).toBe(200);
    expect(db.argsOf("profile_reports", "insert")[0][0]).toEqual({
      source: "card",
      target_doctor_id: TARGET,
      reporter_doctor_id: ME,
      details: "ليس الطبيب الحقيقي",
    });
    expect(db.argsOf("audit_logs", "insert")[0][0]).toMatchObject({ action: "profile_reported", target_doctor_id: TARGET, actor_doctor_id: ME });
    expect(raiseAlert).toHaveBeenCalledWith(expect.anything(), "profile_reported", { extra: { source: "card", report_id: "r1" } });
  });

  it("refuses a visitor, a report on oneself, an empty reason, and too many reports", async () => {
    requireDoctor.mockRejectedValueOnce(new Error("redirect"));
    expect((await call({ target_doctor_id: TARGET, details: "سبب كافٍ" })).status).toBe(401);
    expect((await call({ target_doctor_id: ME, details: "سبب كافٍ" })).status).toBe(400);
    expect((await call({ target_doctor_id: TARGET, details: "x" })).status).toBe(400);
    rateLimit.mockResolvedValueOnce({ success: false });
    expect((await call({ target_doctor_id: TARGET, details: "سبب كافٍ" })).status).toBe(429);
    expect(db.argsOf("profile_reports", "insert")).toHaveLength(0);
  });
});

describe("POST /api/reports/public (the form)", () => {
  const BODY = { name: "سارة خوري", contact: "0521234567", details: "سجّل أحدهم برقم ترخيصي", license_number: "1-189371" };
  const call = async (body: unknown) => (await import("./public/route")).POST(jsonRequest("/api/reports/public", body));

  it("finds the profile holding the licence and files the report with the reporter's contact", async () => {
    db.queue("doctors", { data: { id: TARGET } });
    db.queue("profile_reports", { data: { id: "r2" } });
    expect((await call(BODY)).status).toBe(200);
    // The registry's 1-189371 is the serial 189371.
    expect(String(db.argsOf("doctors", "or")[0][0])).toContain("189371");
    expect(db.argsOf("profile_reports", "insert")[0][0]).toEqual({
      source: "public",
      target_doctor_id: TARGET,
      license_number: "1-189371",
      reporter_name: "سارة خوري",
      reporter_contact: "0521234567",
      details: "سجّل أحدهم برقم ترخيصي",
    });
  });

  it("answers the same when no profile holds the licence", async () => {
    db.queue("doctors", { data: null });
    db.queue("profile_reports", { data: { id: "r3" } });
    const res = await call(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.argsOf("profile_reports", "insert")[0][0]).toMatchObject({ target_doctor_id: null });
  });

  it("needs Turnstile, the per-IP limit and a name, contact and reason", async () => {
    verifyTurnstile.mockResolvedValueOnce({ ok: false });
    expect((await call(BODY)).status).toBe(403);
    rateLimit.mockResolvedValueOnce({ success: false });
    expect((await call(BODY)).status).toBe(429);
    expect((await call({ ...BODY, contact: "" })).status).toBe(400);
    expect(db.argsOf("profile_reports", "insert")).toHaveLength(0);
  });
});
