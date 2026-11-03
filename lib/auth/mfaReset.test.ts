// A reset removes every factor and opens a short window in which the admin may enrol
// a new one; the window ends by itself or when the new factor is confirmed.

import { describe, expect, it, vi } from "vitest";
import { closeEnrolWindow, ENROL_WINDOW_MS, enrolWindowOpen, resetSecondFactor } from "./mfaReset";

function fake(opts: { factors?: { id: string }[]; listError?: Error; deleteError?: Error; updateError?: Error; meta?: Record<string, unknown> } = {}) {
  const admin = {
    mfa: {
      listFactors: vi.fn(async () => (opts.listError ? { data: null, error: opts.listError } : { data: { factors: opts.factors ?? [] }, error: null })),
      deleteFactor: vi.fn(async () => ({ error: opts.deleteError ?? null })),
    },
    updateUserById: vi.fn(async () => ({ error: opts.updateError ?? null })),
    getUserById: vi.fn(async () => ({ data: { user: { app_metadata: opts.meta ?? {} } } })),
  };
  return { admin, client: { auth: { admin } } as never };
}

describe("resetSecondFactor", () => {
  it("removes every factor and opens the window for 15 minutes", async () => {
    const { admin, client } = fake({ factors: [{ id: "f1" }, { id: "f2" }] });
    expect(await resetSecondFactor(client, "u1", 1000)).toBe(2);
    expect(admin.mfa.deleteFactor).toHaveBeenCalledWith({ id: "f1", userId: "u1" });
    expect(admin.mfa.deleteFactor).toHaveBeenCalledWith({ id: "f2", userId: "u1" });
    expect(admin.updateUserById).toHaveBeenCalledWith("u1", { app_metadata: { mfa_enrol_until: 1000 + ENROL_WINDOW_MS } });
  });

  it("opens the window even when there was nothing to remove", async () => {
    const { admin, client } = fake();
    expect(await resetSecondFactor(client, "u1")).toBe(0);
    expect(admin.updateUserById).toHaveBeenCalled();
  });

  it("opens the window before removing anything, so a failure cannot lock the admin out", async () => {
    const { admin, client } = fake({ factors: [{ id: "f1" }], deleteError: new Error("del") });
    await expect(resetSecondFactor(client, "u1")).rejects.toThrow("del");
    expect(admin.updateUserById).toHaveBeenCalled();
    const { admin: a2, client: c2 } = fake({ updateError: new Error("upd") });
    await expect(resetSecondFactor(c2, "u1")).rejects.toThrow("upd");
    expect(a2.mfa.deleteFactor).not.toHaveBeenCalled();
  });

  it("fails loudly at each step instead of half resetting", async () => {
    await expect(resetSecondFactor(fake({ listError: new Error("list") }).client, "u1")).rejects.toThrow("list");
    await expect(resetSecondFactor(fake({ factors: [{ id: "f" }], deleteError: new Error("del") }).client, "u1")).rejects.toThrow("del");
    await expect(resetSecondFactor(fake({ updateError: new Error("upd") }).client, "u1")).rejects.toThrow("upd");
  });
});

describe("the window", () => {
  it("is open until its time, and not otherwise", async () => {
    expect(await enrolWindowOpen(fake({ meta: { mfa_enrol_until: 2000 } }).client, "u1", 1000)).toBe(true);
    expect(await enrolWindowOpen(fake({ meta: { mfa_enrol_until: 2000 } }).client, "u1", 2000)).toBe(false);
    expect(await enrolWindowOpen(fake({ meta: { mfa_enrol_until: null } }).client, "u1", 1000)).toBe(false);
    expect(await enrolWindowOpen(fake().client, "u1", 1000)).toBe(false);
  });

  it("reads as closed, and says so, when the account cannot be read or cleared", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = fake();
    bad.admin.getUserById.mockResolvedValueOnce({ data: null as never, error: new Error("down") } as never);
    expect(await enrolWindowOpen(bad.client, "u1")).toBe(false);
    const stuck = fake({ updateError: new Error("upd") });
    await closeEnrolWindow(stuck.client, "u1");
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("is closed by clearing the mark", async () => {
    const { admin, client } = fake();
    await closeEnrolWindow(client, "u1");
    expect(admin.updateUserById).toHaveBeenCalledWith("u1", { app_metadata: { mfa_enrol_until: null } });
  });
});
