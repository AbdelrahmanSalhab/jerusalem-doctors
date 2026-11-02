// Admins remind an unfinished signup (a WhatsApp message whose link reopens
// the form) or delete it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const requireAdminOrNull = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const ID = "00000000-0000-4000-8000-0000000002b2";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const route = () => import("./[id]/route");

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  requireAdminOrNull.mockResolvedValue({ id: "admin-1" });
});

describe("POST /api/admin/pending-signups/[id]", () => {
  const remind = async (id = ID) => (await route()).POST(jsonRequest(`/api/admin/pending-signups/${id}`, {}), ctx(id));

  it("refuses a non-admin", async () => {
    requireAdminOrNull.mockResolvedValue(null);
    expect((await remind()).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("makes a WhatsApp reminder whose link reopens the form, storing only the token's hash", async () => {
    db.queue("pending_signups", { data: { phone_e164: "+972521234567", payload: { arabic_first_name: "سارة", resume_form: {} } } });
    const res = await remind();
    const { whatsapp } = await res.json();
    const url = new URL(whatsapp);
    expect(url.origin + url.pathname).toBe("https://wa.me/972521234567");
    const text = url.searchParams.get("text")!;
    expect(text).toContain("مرحبًا د. سارة");
    const token = /\/signup\?resume=([\w-]+)/.exec(text)![1];
    const update = db.argsOf("pending_signups", "update")[0][0] as { resume_token_hash: string; reminded_at: string };
    expect(update.resume_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(update.resume_token_hash).not.toContain(token);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toMatchObject({ action: "unfinished_signup_reminded", actor_doctor_id: "admin-1" });
  });

  it("has nothing to remind for a returning phone's sign-in attempt, or a deleted signup", async () => {
    db.queue("pending_signups", { data: { phone_e164: "+972521234567", payload: { existing_doctor_id: "d1" } } });
    expect((await remind()).status).toBe(404);
    db.queue("pending_signups", { data: null });
    expect((await remind()).status).toBe(404);
    expect((await remind("not-a-uuid")).status).toBe(404);
  });
});

describe("DELETE /api/admin/pending-signups/[id]", () => {
  const discard = async () => (await route()).DELETE(jsonRequest(`/api/admin/pending-signups/${ID}`, {}), ctx());

  it("deletes the signup and audits it", async () => {
    db.queue("pending_signups", { data: { payload: { arabic_first_name: "سارة" } } });
    expect((await discard()).status).toBe(200);
    expect(db.argsOf("pending_signups", "eq")).toContainEqual(["id", ID]);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toMatchObject({ action: "unfinished_signup_deleted", metadata: { name: "سارة" } });
  });

  it("refuses a non-admin", async () => {
    requireAdminOrNull.mockResolvedValue(null);
    expect((await discard()).status).toBe(401);
  });
});

describe("pending signups: edges", () => {
  it("404s a malformed id on both verbs, without asking the database", async () => {
    const r = await route();
    expect((await r.POST(jsonRequest("/x", {}), ctx("abc"))).status).toBe(404);
    expect((await r.DELETE(jsonRequest("/x", {}), ctx("abc"))).status).toBe(404);
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a non-admin on delete", async () => {
    requireAdminOrNull.mockResolvedValue(null);
    expect((await (await route()).DELETE(jsonRequest("/x", {}), ctx())).status).toBe(401);
  });

  it("fails on a database error, and 404s a signup that is already gone", async () => {
    const r = await route();
    db.queue("pending_signups", { error: { message: "boom" } });
    expect((await r.POST(jsonRequest("/x", {}), ctx())).status).toBe(500);
    db.queue("pending_signups", { error: { message: "boom" } });
    expect((await r.DELETE(jsonRequest("/x", {}), ctx())).status).toBe(500);
    db.queue("pending_signups", { data: null });
    expect((await r.DELETE(jsonRequest("/x", {}), ctx())).status).toBe(404);
  });

  it("greets and logs a signup that has no first name yet", async () => {
    const r = await route();
    db.queue("pending_signups", { data: { phone_e164: "+972521234567", payload: { resume_form: {} } } });
    expect((await r.POST(jsonRequest("/x", {}), ctx())).status).toBe(200);
    expect(db.argsOf("audit_logs", "insert")[0][0]).toMatchObject({ metadata: { name: null } });
    db.queue("pending_signups", { data: { payload: {} } });
    expect((await r.DELETE(jsonRequest("/x", {}), ctx())).status).toBe(200);
    expect(db.argsOf("audit_logs", "insert")[1][0]).toMatchObject({ metadata: { name: null } });
  });
});
