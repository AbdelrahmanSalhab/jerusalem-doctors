// POST /api/usage/install records an install step (#150), only for
// signed-in doctors, and never fails the step.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/test/fakeSupabase";

const { requireDoctor, rateLimit } = vi.hoisted(() => ({ requireDoctor: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const beacon = (body: unknown) =>
  new Request("https://example.test/api/usage/install", {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const post = async (body: unknown) => (await import("./route")).POST(beacon(body));

describe("POST /api/usage/install", () => {
  beforeEach(() => {
    db.reset();
    vi.clearAllMocks();
    requireDoctor.mockResolvedValue({ id: "me" });
    rateLimit.mockResolvedValue({ success: true });
  });

  it("records the step, the doctor, the browser family and which button", async () => {
    expect((await post({ kind: "install_click", guide: "android", source: "menu" })).status).toBe(204);
    expect((await post({ kind: "install_app_opened", guide: "ios-safari" })).status).toBe(204);
    expect(db.argsOf("usage_events", "insert").map((a) => a[0])).toEqual([
      { kind: "install_click", doctor_id: "me", meta: { guide: "android", source: "menu" } },
      { kind: "install_app_opened", doctor_id: "me", meta: { guide: "ios-safari" } },
    ]);
  });

  it("refuses visitors, other kinds and anything extra-looking", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ kind: "search", guide: "android" })).status).toBe(400);
    expect((await post({ kind: "install_click", guide: "nokia" })).status).toBe(400);
    expect((await post({ kind: "install_click", guide: "android", source: "footer" })).status).toBe(400);
    requireDoctor.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    expect((await post({ kind: "install_click", guide: "android" })).status).toBe(401);
    expect(db.argsOf("usage_events", "insert")).toEqual([]);
  });

  it("stops recording past the rate limit, still answering", async () => {
    rateLimit.mockResolvedValueOnce({ success: false });
    expect((await post({ kind: "install_click", guide: "android" })).status).toBe(204);
    expect(db.argsOf("usage_events", "insert")).toEqual([]);
  });
});
