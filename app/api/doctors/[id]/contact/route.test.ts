// POST /api/doctors/[id]/contact: the numbers behind a tap, within the day's
// budget (#16).

import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "6f1f4f2e-7d0a-4a43-9d0f-2f4b1b7c9a10";
const ME = { id: "viewer-1", approved_at: "2026-01-01T00:00:00Z" };

const gate = vi.hoisted(() => ({ signedIn: true, refused: false, rateOk: true, found: true }));
const raiseAlert = vi.hoisted(() => vi.fn(async () => {}));
const countReveal = vi.hoisted(() => vi.fn(async () => ({ allowed: true, used: 1, limit: 25 })));
const claimOnce = vi.hoisted(() => vi.fn(async () => true));
const asked = vi.hoisted(() => ({ table: "", id: "" }));

vi.mock("@/lib/alerts", () => ({ raiseAlert }));
vi.mock("@/lib/otp/sentOnce", () => ({ claimOnce }));
vi.mock("@/lib/contactBudget", async (orig) => ({ ...(await orig<typeof import("@/lib/contactBudget")>()), countReveal }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: gate.rateOk })) }));
vi.mock("@/lib/auth/session", () => ({
  requireDoctor: vi.fn(async () => {
    if (!gate.signedIn) throw new Error("no session");
    return ME;
  }),
}));
vi.mock("@/lib/auth/directoryAccess", () => ({
  refuseUnlessApproved: vi.fn(async () => (gate.refused ? Response.json({ code: "not_approved" }, { status: 403 }) : null)),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => {
            asked.table = table;
            asked.id = id;
            return { data: gate.found ? { phone_display: "050-123-4567", phone_e164: "+972501234567", email: "a@b.test" } : null, error: null };
          },
        }),
      }),
    }),
  }),
}));

async function call(id = ID) {
  const { POST } = await import("./route");
  return POST(new Request("https://example.test/x", { method: "POST" }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  Object.assign(gate, { signedIn: true, refused: false, rateOk: true, found: true });
  countReveal.mockClear().mockResolvedValue({ allowed: true, used: 1, limit: 25 });
  claimOnce.mockClear().mockResolvedValue(true);
  raiseAlert.mockClear();
});

describe("POST /api/doctors/[id]/contact", () => {
  it("returns the doctor's number, WhatsApp link and email, read from the listed view", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ phone_display: "050-123-4567", phone_e164: "+972501234567", email: "a@b.test", whatsapp_url: expect.stringContaining("972501234567") });
    expect(asked).toEqual({ table: "listed_doctors", id: ID });
    expect(countReveal).toHaveBeenCalledWith("viewer-1", ID, 25);
  });

  it("is refused to someone not signed in and to a doctor not yet accepted", async () => {
    gate.signedIn = false;
    expect((await call()).status).toBe(401);
    gate.signedIn = true;
    gate.refused = true;
    expect((await call()).status).toBe(403);
    expect(countReveal).not.toHaveBeenCalled();
  });

  it("answers 404 for a bad id or an unlisted doctor, without using any budget", async () => {
    expect((await call("not-an-id")).status).toBe(404);
    gate.found = false;
    expect((await call()).status).toBe(404);
    expect(countReveal).not.toHaveBeenCalled();
  });

  it("refuses over the day's budget, shows nothing, and tells the admins once", async () => {
    countReveal.mockResolvedValue({ allowed: false, used: 25, limit: 25 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(JSON.stringify(await res.json())).not.toContain("050");
    expect(raiseAlert).toHaveBeenCalledWith(expect.anything(), "directory_heavy_use", { extra: { doctor_id: "viewer-1", reveals: 25 } });

    claimOnce.mockResolvedValue(false);
    raiseAlert.mockClear();
    expect((await call()).status).toBe(429);
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("slows a loop with the per-minute limit", async () => {
    gate.rateOk = false;
    expect((await call()).status).toBe(429);
    expect(countReveal).not.toHaveBeenCalled();
  });
});
