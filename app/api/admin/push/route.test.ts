// An admin turns notifications on or off for the device they are on: admins
// only, a real push address, and a row is only ever removed by its owner.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jsonRequest } from "@/test/fakeSupabase";

const requireAdminOrNull = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn(async () => ({ success: gate.allowed })) }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BPkey", auth: "authkey" } };
const post = async (body: unknown) => (await import("./route")).POST(jsonRequest("/api/admin/push", body));
const del = async (body: unknown) => (await import("./route")).DELETE(jsonRequest("/api/admin/push", body));

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  gate.allowed = true;
  requireAdminOrNull.mockResolvedValue({ id: "admin-1" });
});

describe("POST /api/admin/push", () => {
  it("keeps the device for the admin, replacing the row if the device is already known", async () => {
    expect((await post(SUB)).status).toBe(200);
    expect(db.argsOf("push_subscriptions", "upsert")).toEqual([
      [{ doctor_id: "admin-1", endpoint: SUB.endpoint, p256dh: "BPkey", auth: "authkey" }, { onConflict: "endpoint" }],
    ]);
  });

  it("is for admins only, and brakes a runaway loop", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await post(SUB)).status).toBe(401);
    gate.allowed = false;
    expect((await post(SUB)).status).toBe(429);
    expect(db.argsOf("push_subscriptions", "upsert")).toEqual([]);
  });

  it("refuses an address that is not a push service's, and a body without the keys", async () => {
    for (const body of [{ ...SUB, endpoint: "http://insecure.example/x" }, { ...SUB, endpoint: "not a url" }, { endpoint: SUB.endpoint }, { ...SUB, keys: { p256dh: "", auth: "a" } }, null]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(db.argsOf("push_subscriptions", "upsert")).toEqual([]);
  });

  it("fails when the database does", async () => {
    db.queue("push_subscriptions", { error: { message: "down" } });
    expect((await post(SUB)).status).toBe(500);
  });
});

describe("DELETE /api/admin/push", () => {
  it("removes the device, but only if it is this admin's", async () => {
    expect((await del({ endpoint: SUB.endpoint })).status).toBe(200);
    expect(db.argsOf("push_subscriptions", "eq")).toEqual([["endpoint", SUB.endpoint], ["doctor_id", "admin-1"]]);
  });

  it("is for admins only, rate limited, and wants an endpoint", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await del({ endpoint: SUB.endpoint })).status).toBe(401);
    gate.allowed = false;
    expect((await del({ endpoint: SUB.endpoint })).status).toBe(429);
    gate.allowed = true;
    expect((await del({})).status).toBe(400);
  });

  it("fails when the database does", async () => {
    db.queue("push_subscriptions", { error: { message: "down" } });
    expect((await del({ endpoint: SUB.endpoint })).status).toBe(500);
  });
});
