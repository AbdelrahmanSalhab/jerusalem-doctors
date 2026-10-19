// POST /api/usage/contact records who contacted whom, only for signed-in
// doctors, and never fails the press.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/test/fakeSupabase";

const { requireDoctor, rateLimit } = vi.hoisted(() => ({ requireDoctor: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const TARGET = "11111111-1111-4111-8111-111111111111";
const beacon = (body: unknown) =>
  new Request("https://example.test/api/usage/contact", {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const post = async (body: unknown) => (await import("./route")).POST(beacon(body));

describe("POST /api/usage/contact", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    requireDoctor.mockResolvedValue({ id: "me" });
    rateLimit.mockResolvedValue({ success: true });
  });

  it("records the channel, the viewer and the colleague", async () => {
    const res = await post({ target: TARGET, channel: "whatsapp" });
    expect(res.status).toBe(204);
    expect(db.argsOf("usage_events", "insert")[0][0]).toEqual({
      kind: "contact_whatsapp",
      doctor_id: "me",
      meta: { target: TARGET },
    });
  });

  it("refuses visitors and bad bodies", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ target: "x", channel: "whatsapp" })).status).toBe(400);
    requireDoctor.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    expect((await post({ target: TARGET, channel: "call" })).status).toBe(401);
    expect(db.argsOf("usage_events", "insert")).toEqual([]);
  });

  it("stops recording past the rate limit, still answering", async () => {
    rateLimit.mockResolvedValueOnce({ success: false });
    expect((await post({ target: TARGET, channel: "call" })).status).toBe(204);
    expect(db.argsOf("usage_events", "insert")).toEqual([]);
  });
});
