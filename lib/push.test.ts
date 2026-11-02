// Web Push to the admins: off without keys, one buzz per alert in a while,
// only to admins who still are, nothing personal in the message, and a dead
// phone is forgotten.

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.hoisted(() => vi.fn());
const claimOnce = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => ({ default: { sendNotification } }));
vi.mock("@/lib/otp/sentOnce", () => ({ claimOnce }));

import { PUSH_THROTTLE_SECONDS, pushConfigured, sendPushToAdmins, sendTestPush } from "./push";

const MESSAGE = { title: "طبيب جديد بانتظار القبول", url: "/admin?status=pending", tag: "doctor_waiting" };
const ROW = (id: string) => ({ id, endpoint: `https://push.example/${id}`, p256dh: `p-${id}`, auth: `a-${id}`, doctor: { is_admin: true, is_active: true } });

/** A client whose subscription read answers `result`; records the filters and the deletes. */
function client(result: { data?: unknown; error?: unknown }) {
  const eqs: [string, unknown][] = [];
  const deleted: string[][] = [];
  const read: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...result }).then(ok) };
  read.select = () => read;
  read.eq = (col: string, v: unknown) => (eqs.push([col, v]), read);
  const service = {
    from: () => ({
      select: read.select,
      delete: () => ({ in: async (_: string, ids: string[]) => (deleted.push(ids), { error: null }) }),
    }),
  } as unknown as SupabaseClient;
  return { service, eqs, deleted };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
  claimOnce.mockResolvedValue(true);
  sendNotification.mockResolvedValue({ statusCode: 201 });
});

describe("sendPushToAdmins", () => {
  it("does nothing without the keys, and says it is not configured", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const { service, eqs } = client({ data: [ROW("1")] });
    await sendPushToAdmins(service, MESSAGE);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(eqs).toEqual([]);
    expect(pushConfigured()).toBe(false);
  });

  it("sends the title and link, and nothing else, to every subscription of an admin", async () => {
    const { service, eqs } = client({ data: [ROW("1"), ROW("2")] });
    await sendPushToAdmins(service, MESSAGE);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [target, body, options] = sendNotification.mock.calls[0];
    expect(target).toEqual({ endpoint: "https://push.example/1", keys: { p256dh: "p-1", auth: "a-1" } });
    expect(JSON.parse(body)).toEqual(MESSAGE);
    expect(options).toMatchObject({ vapidDetails: { publicKey: "pub", privateKey: "priv", subject: "mailto:ops@example.com" }, TTL: 3600, timeout: 5000 });
    expect(eqs).toEqual([["doctor.is_admin", true], ["doctor.is_active", true]]);
    expect(pushConfigured()).toBe(true);
  });

  it("buzzes once per alert in the throttle window", async () => {
    claimOnce.mockResolvedValueOnce(false);
    const { service } = client({ data: [ROW("1")] });
    await sendPushToAdmins(service, MESSAGE);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(claimOnce).toHaveBeenCalledWith("push:doctor_waiting", PUSH_THROTTLE_SECONDS);
  });

  it("forgets a phone the push service says is gone, and only that one", async () => {
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { statusCode: 404 }))
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { statusCode: 503 }));
    const { service, deleted } = client({ data: [ROW("1"), ROW("2"), ROW("3"), ROW("4")] });
    await sendPushToAdmins(service, MESSAGE);
    expect(deleted).toEqual([["1", "2"]]);
  });

  it("does not log a phone's address when a send fails", async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }));
    const { service } = client({ data: [ROW("1")] });
    await sendPushToAdmins(service, MESSAGE);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("push.example");
  });

  it("stays quiet when there are no subscriptions, and when they cannot be read", async () => {
    await sendPushToAdmins(client({ data: [] }).service, MESSAGE);
    await sendPushToAdmins(client({ data: null, error: { code: "42P01", message: "no table" } }).service, MESSAGE);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[push] subscriptions not read", "42P01");
  });

  it("never throws, whatever goes wrong", async () => {
    claimOnce.mockRejectedValueOnce(new Error("redis down"));
    await expect(sendPushToAdmins(client({ data: [ROW("1")] }).service, MESSAGE)).resolves.toBeUndefined();
  });
});

describe("sendTestPush", () => {
  it("is null when the keys are not set, and reads nothing", async () => {
    vi.stubEnv("VAPID_SUBJECT", "");
    const { service, eqs } = client({ data: [ROW("1")] });
    expect(await sendTestPush(service, "admin-1")).toBeNull();
    expect(eqs).toEqual([]);
  });

  it("sends at once to this admin's own devices, unthrottled, and counts the ones that got it", async () => {
    sendNotification.mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    const { service, eqs, deleted } = client({ data: [ROW("1"), ROW("2")] });
    expect(await sendTestPush(service, "admin-1")).toBe(1);
    expect(eqs).toEqual([["doctor_id", "admin-1"]]);
    expect(deleted).toEqual([["2"]]);
    expect(claimOnce).not.toHaveBeenCalled();
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({ tag: "test", url: "/admin" });
  });

  it("throws when the devices cannot be read, so the route can say so", async () => {
    await expect(sendTestPush(client({ data: null, error: new Error("down") }).service, "admin-1")).rejects.toThrow("down");
  });
});
