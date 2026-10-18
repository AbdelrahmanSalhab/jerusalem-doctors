// The upload's type comes from the file's bytes, never from the
// client-supplied Content-Type, so a renamed text or HTML file can't land in
// the public bucket labelled as an image.

import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadSpy = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireDoctor: vi.fn(async () => ({ id: "doc-1" })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, _body: unknown, opts: { contentType: string }) => {
          uploadSpy(path, opts.contentType);
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

import { POST } from "./route";

function upload(bytes: Uint8Array<ArrayBuffer>, type: string, name: string): Request {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  return new Request("https://example.test/api/profile/photo", { method: "POST", body: form });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe("POST /api/profile/photo", () => {
  beforeEach(() => uploadSpy.mockReset());

  it("rejects a text file sent as image/jpeg", async () => {
    const res = await POST(upload(new TextEncoder().encode("<html>hi</html>"), "image/jpeg", "x.jpg"));
    expect(res.status).toBe(415);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("stores a PNG by its bytes even when labelled image/jpeg", async () => {
    const res = await POST(upload(PNG, "image/jpeg", "x.jpg"));
    expect(res.status).toBe(200);
    expect(uploadSpy).toHaveBeenCalledWith("doc-1.png", "image/png");
  });
});
