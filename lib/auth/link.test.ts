import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { linkAuthUser } from "./link";

function service(error: unknown = null) {
  const eq = vi.fn(async () => ({ error }));
  const update = vi.fn(() => ({ eq }));
  return {
    client: { from: () => ({ update }) } as unknown as SupabaseClient,
    update,
    eq,
  };
}

describe("linkAuthUser", () => {
  it("does nothing when the row already points at the user", async () => {
    const s = service();
    expect(await linkAuthUser(s.client, { id: "d1", auth_user_id: "u1" }, "u1")).toBe(true);
    expect(s.update).not.toHaveBeenCalled();
  });

  it("links an unlinked row", async () => {
    const s = service();
    expect(await linkAuthUser(s.client, { id: "d1", auth_user_id: null }, "u1")).toBe(true);
    expect(s.update).toHaveBeenCalledWith({ auth_user_id: "u1" });
    expect(s.eq).toHaveBeenCalledWith("id", "d1");
  });

  it("reports a failed update", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = service({ message: "boom" });
    expect(await linkAuthUser(s.client, { id: "d1", auth_user_id: "old" }, "u1")).toBe(false);
  });
});
