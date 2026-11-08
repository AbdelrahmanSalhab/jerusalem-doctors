// Who may read the directory: the rules of #16, and the one switch that
// relaxes the first of them.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ awaiting: false, search_before_review: false }));
const settingsRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ awaitingSecondFactor: async () => state.awaiting }));
vi.mock("@/lib/cachedReads", () => ({
  cachedSiteSettings: async () => {
    settingsRead();
    return { search_before_review: state.search_before_review, contacts_without_tap: false };
  },
}));

const viewer = (over: Partial<{ is_active: boolean; is_admin_approved: boolean; is_admin: boolean }> = {}) => ({
  is_active: true,
  is_admin_approved: false,
  is_admin: false,
  ...over,
});

beforeEach(() => {
  Object.assign(state, { awaiting: false, search_before_review: false });
  settingsRead.mockClear();
});

describe("canSeeDirectory", () => {
  it("lets an accepted doctor in, without reading the switches", async () => {
    const { canSeeDirectory } = await import("./directoryAccess");
    expect(await canSeeDirectory(viewer({ is_admin_approved: true }))).toBe(true);
    expect(settingsRead).not.toHaveBeenCalled();
  });

  it("keeps a doctor who is not accepted out by default (#16)", async () => {
    const { canSeeDirectory, refuseUnlessApproved } = await import("./directoryAccess");
    expect(await canSeeDirectory(viewer())).toBe(false);
    const refused = await refuseUnlessApproved(viewer());
    expect(refused?.status).toBe(403);
    expect(await refused?.json()).toMatchObject({ code: "not_approved" });
  });

  it("lets that doctor in once «search before review» is open", async () => {
    state.search_before_review = true;
    const { canSeeDirectory, refuseUnlessApproved } = await import("./directoryAccess");
    expect(await canSeeDirectory(viewer())).toBe(true);
    expect(await refuseUnlessApproved(viewer())).toBeNull();
  });

  it("still refuses a closed account and an admin without the second factor, whatever the switch", async () => {
    state.search_before_review = true;
    const { canSeeDirectory } = await import("./directoryAccess");
    expect(await canSeeDirectory(viewer({ is_active: false, is_admin_approved: true }))).toBe(false);
    expect(await canSeeDirectory(viewer({ is_active: false }))).toBe(false);
    state.awaiting = true;
    expect(await canSeeDirectory(viewer({ is_admin: true, is_admin_approved: true }))).toBe(false);
    expect(await canSeeDirectory(viewer({ is_admin: true }))).toBe(false);
  });
});
