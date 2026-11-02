// An admin replacing or removing someone else's photo. The upload itself is
// covered by the doctor's own route; what matters here is that only an admin
// gets in, that an unknown id is refused before anything is written, and
// that both outcomes reach the activity log.

import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadSpy = vi.fn();
const removeSpy = vi.fn();
const updates: Record<string, unknown>[] = [];
const audits: Record<string, unknown>[] = [];

let doctorExists = true;
let readError: { code: string } | null = null;
let removeError: unknown = null;
const gate = vi.hoisted(() => ({ allowed: true }));

const { requireAdminOrNull } = vi.hoisted(() => ({
  requireAdminOrNull: vi.fn(async (): Promise<{ id: string } | null> => ({
    id: "00000000-0000-4000-8000-00000000a001",
  })),
}));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: gate.allowed })) }));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, _body: unknown, opts: { contentType: string }) => {
          uploadSpy(path, opts.contentType);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removeSpy(paths);
          return { error: removeError };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: doctorExists ? { id: "00000000-0000-4000-8000-0000000000d1" } : null, error: readError }) }),
      }),
      update(values: Record<string, unknown>) {
        updates.push(values);
        return { eq: async () => ({ error: null }) };
      },
      insert: async (row: Record<string, unknown>) => {
        if (table === "audit_logs") audits.push(row);
        return { error: null };
      },
    }),
  }),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const ctx = { params: Promise.resolve({ id: "00000000-0000-4000-8000-0000000000d1" }) };

function post(bytes: Uint8Array<ArrayBuffer> = PNG) {
  const form = new FormData();
  form.set("file", new File([bytes], "x.png", { type: "image/png" }));
  return new Request("https://example.test/api/admin/doctors/00000000-0000-4000-8000-0000000000d1/photo", { method: "POST", body: form });
}

beforeEach(() => {
  uploadSpy.mockReset();
  removeSpy.mockReset();
  updates.length = 0;
  audits.length = 0;
  requireAdminOrNull.mockClear();
  doctorExists = true;
  readError = null;
  removeError = null;
  gate.allowed = true;
});

describe("POST /api/admin/doctors/[id]/photo", () => {
  it("refuses anyone who is not an admin", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    expect((await POST(post(), ctx)).status).toBe(401);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("refuses an unknown doctor before touching storage", async () => {
    doctorExists = false;
    const { POST } = await import("./route");
    expect((await POST(post(), ctx)).status).toBe(404);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("stores the photo under the target doctor's id and logs it", async () => {
    const { POST } = await import("./route");
    const res = await POST(post(), ctx);
    expect(res.status).toBe(200);
    expect(uploadSpy).toHaveBeenCalledWith("00000000-0000-4000-8000-0000000000d1.png", "image/png");
    expect(String(updates[0].profile_picture_url)).toContain("?v=");
    expect(audits[0]).toMatchObject({
      action: "admin_doctor_photo_changed",
      target_doctor_id: "00000000-0000-4000-8000-0000000000d1",
      metadata: { removed: false },
    });
  });

  it("rejects a text file sent as an image, by its bytes", async () => {
    const { POST } = await import("./route");
    const form = new FormData();
    form.set("file", new File([new TextEncoder().encode("<html>")], "x.png", { type: "image/png" }));
    const res = await POST(
      new Request("https://example.test/api/admin/doctors/00000000-0000-4000-8000-0000000000d1/photo", { method: "POST", body: form }),
      ctx,
    );
    expect(res.status).toBe(415);
  });
});

describe("DELETE /api/admin/doctors/[id]/photo", () => {
  it("clears every name the photo could have, and the column", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("https://example.test/x", { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect(removeSpy).toHaveBeenCalledWith(["00000000-0000-4000-8000-0000000000d1.jpg", "00000000-0000-4000-8000-0000000000d1.png", "00000000-0000-4000-8000-0000000000d1.webp"]);
    expect(updates[0]).toEqual({ profile_picture_url: null });
    expect(audits[0]).toMatchObject({ metadata: { removed: true } });
  });

  it("refuses anyone who is not an admin", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    const { DELETE } = await import("./route");
    expect((await DELETE(new Request("https://example.test/x", { method: "DELETE" }), ctx)).status).toBe(401);
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

describe("admin photo: refusals and failures", () => {
  it("stops a flood of uploads, a malformed id and a request with no file", async () => {
    const { POST } = await import("./route");
    gate.allowed = false;
    expect((await POST(post(), ctx)).status).toBe(429);
    gate.allowed = true;
    expect((await POST(post(), { params: Promise.resolve({ id: "abc" }) })).status).toBe(404);
    const empty = new Request("https://example.test/x", { method: "POST", body: new FormData() });
    expect((await POST(empty, ctx)).status).toBe(400);
    expect((await POST(new Request("https://example.test/x", { method: "POST", body: "nope" }), ctx)).status).toBe(400);
  });

  it("fails when the doctor lookup fails", async () => {
    const { POST } = await import("./route");
    readError = { code: "XX000" };
    expect((await POST(post(), ctx)).status).toBe(500);
  });

  it("removes a photo for an admin, 404s a bad id or unknown doctor, and reports a storage failure", async () => {
    const { DELETE } = await import("./route");
    const req = new Request("https://example.test/x", { method: "DELETE" });
    expect((await DELETE(req, ctx)).status).toBe(200);
    expect(audits.at(-1)).toMatchObject({ metadata: { removed: true } });
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await DELETE(req, ctx)).status).toBe(401);
    expect((await DELETE(req, { params: Promise.resolve({ id: "abc" }) })).status).toBe(404);
    doctorExists = false;
    expect((await DELETE(req, ctx)).status).toBe(404);
    doctorExists = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    removeError = { message: "storage down" };
    expect((await DELETE(req, ctx)).status).toBe(500);
  });
});
