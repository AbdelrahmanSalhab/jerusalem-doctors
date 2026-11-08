// The bytes decide the type, and every failed step says which one failed.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHOTO_MAX_BYTES, removeDoctorPhoto, uploadDoctorPhoto } from "./photoUpload";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const png = () => new File([PNG], "me.png", { type: "image/png" });

function service(opts: { uploadError?: unknown; updateError?: unknown; removeError?: unknown } = {}) {
  const updates: unknown[] = [];
  const removed: string[][] = [];
  const client = {
    storage: {
      from: () => ({
        upload: async () => ({ error: opts.uploadError ?? null }),
        remove: async (names: string[]) => (removed.push(names), { error: opts.removeError ?? null }),
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.test/${p}` } }),
      }),
    },
    from: () => ({ update: (v: unknown) => (updates.push(v), { eq: async () => ({ error: opts.updateError ?? null }) }) }),
  } as unknown as SupabaseClient;
  return { client, updates, removed };
}

afterEach(() => vi.restoreAllMocks());

describe("uploadDoctorPhoto", () => {
  it("stores a real image and points the profile at it", async () => {
    const { client, updates } = service();
    const out = await uploadDoctorPhoto(client, "d1", png(), "t");
    expect(out).toMatchObject({ url: expect.stringContaining("https://cdn.test/") });
    expect(updates[0]).toMatchObject({ profile_picture_url: expect.stringContaining("?v=") });
  });

  it("removes the same doctor's photo under the other types, so a replaced photo does not linger", async () => {
    const { client, removed } = service();
    await uploadDoctorPhoto(client, "d1", png(), "t");
    expect(removed).toEqual([["d1.jpg", "d1.webp"]]);
  });

  it("keeps the new photo when clearing the old one fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await uploadDoctorPhoto(service({ removeError: { message: "x" } }).client, "d1", png(), "t");
    expect(out).toMatchObject({ url: expect.stringContaining("d1.png") });
  });

  it("refuses a file over 2 MB, and bytes that are not an image whatever the client says", async () => {
    const big = new File([new Uint8Array(PHOTO_MAX_BYTES + 1)], "big.png", { type: "image/png" });
    expect(await uploadDoctorPhoto(service().client, "d1", big, "t")).toEqual({ error: { status: 413, code: "file_too_large" } });
    const fake = new File([new Uint8Array([1, 2, 3, 4])], "x.png", { type: "image/png" });
    expect(await uploadDoctorPhoto(service().client, "d1", fake, "t")).toEqual({ error: { status: 415, code: "unsupported_type" } });
  });

  it("names the step that failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await uploadDoctorPhoto(service({ uploadError: { message: "x" } }).client, "d1", png(), "t")).toEqual({ error: { status: 500, code: "upload_failed" } });
    expect(await uploadDoctorPhoto(service({ updateError: { message: "x" } }).client, "d1", png(), "t")).toEqual({ error: { status: 500, code: "update_failed" } });
  });
});

describe("removeDoctorPhoto", () => {
  it("takes the photo down and clears the column", async () => {
    const { client, updates } = service();
    expect(await removeDoctorPhoto(client, "d1", "t")).toBeNull();
    expect(updates).toEqual([{ profile_picture_url: null }]);
  });

  it("names the step that failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await removeDoctorPhoto(service({ removeError: { message: "x" } }).client, "d1", "t")).toEqual({ status: 500, code: "upload_failed" });
    expect(await removeDoctorPhoto(service({ updateError: { message: "x" } }).client, "d1", "t")).toEqual({ status: 500, code: "update_failed" });
  });
});
