// The thin routes' remaining edges: a body that is not JSON, a caller who is
// not signed in, a missing file, and the cron secret.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireDoctor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ requireDoctor }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/reports", () => ({ fileReport: vi.fn(), doctorByLicense: vi.fn(async () => "d9") }));
vi.mock("@/lib/institutions", () => ({
  fetchInstitutions: vi.fn(async () => [{ id: "i1", name_ar: "المقاصد", kind: "hospital", aliases: ["x"] }]),
}));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const bad = (path: string) => new Request(`http://x${path}`, { method: "POST", body: "not json" });

beforeEach(() => {
  vi.clearAllMocks();
  requireDoctor.mockResolvedValue({ id: "me", is_active: true, is_admin_approved: true, is_admin: false });
});

describe("GET /api/institutions", () => {
  it("lists names and kinds, cached, and keeps ids and spellings to itself", async () => {
    const res = await (await import("./institutions/route")).GET(new Request("http://x/api/institutions"));
    expect(await res.json()).toEqual({ institutions: [{ name: "المقاصد", kind: "hospital" }] });
    expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
  });
});

describe("a body that is not JSON", () => {
  it("is a 400 on every route that reads one", async () => {
    expect((await (await import("./reports/route")).POST(bad("/api/reports"))).status).toBe(400);
    expect((await (await import("./number-requests/route")).POST(bad("/api/number-requests"))).status).toBe(400);
    expect((await (await import("./reports/public/route")).POST(bad("/api/reports/public"))).status).toBe(400);
  });
});

describe("POST /api/profile/photo", () => {
  it("wants a signed-in doctor and a file", async () => {
    const { POST } = await import("./profile/photo/route");
    requireDoctor.mockRejectedValueOnce(new Error("no session"));
    expect((await POST(new Request("http://x/api/profile/photo", { method: "POST" }))).status).toBe(401);
    const form = new FormData();
    form.set("note", "no file here");
    expect((await POST(new Request("http://x/api/profile/photo", { method: "POST", body: form }))).status).toBe(400);
    expect((await POST(new Request("http://x/api/profile/photo", { method: "POST", body: "not a form" }))).status).toBe(400);
  });
});

describe("GET /api/cron/metrics", () => {
  it("refuses a request without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await (await import("./cron/metrics/route")).GET(new Request("http://x/api/cron/metrics"));
    expect(res.status).toBe(401);
    vi.unstubAllEnvs();
  });
});
