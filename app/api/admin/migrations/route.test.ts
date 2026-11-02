// The smoke check reads which SQL files ran; only an admin may.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/test/fakeSupabase";

const requireAdminOrNull = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  requireAdminOrNull.mockResolvedValue({ id: "admin-1" });
});

describe("GET /api/admin/migrations", () => {
  it("lists the names that ran, for an admin", async () => {
    db.queue("applied_migrations", { data: [{ name: "a.sql" }, { name: "b.sql" }] });
    const res = await (await import("./route")).GET(new Request("http://x/api/admin/migrations"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: ["a.sql", "b.sql"] });
  });

  it("answers 401 to anyone else, before reading anything", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    const res = await (await import("./route")).GET(new Request("http://x/api/admin/migrations"));
    expect(res.status).toBe(401);
    expect(db.argsOf("applied_migrations", "select")).toEqual([]);
  });
});
