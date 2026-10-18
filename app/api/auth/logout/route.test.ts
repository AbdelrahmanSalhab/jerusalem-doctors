import { describe, expect, it, vi } from "vitest";
import { jsonRequest } from "@/test/fakeSupabase";

const signOut = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));

describe("POST /api/auth/logout", () => {
  it("signs the session out", async () => {
    const { POST } = await import("./route");
    const res = await POST(jsonRequest("/api/auth/logout", {}));
    expect(await res.json()).toEqual({ ok: true });
    expect(signOut).toHaveBeenCalledOnce();
  });
});
