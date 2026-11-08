// The directory's two switches: what a read gives, and who the numbers go to.

import { describe, expect, it, vi } from "vitest";
import { ALL_OFF, contactsInline, fetchSiteSettings } from "@/lib/siteSettings";

const reading = (result: { data: unknown; error: unknown }) => ({
  from: vi.fn(() => ({ select: () => ({ maybeSingle: async () => result }) })),
});

describe("fetchSiteSettings", () => {
  it("reads the row", async () => {
    const service = reading({ data: { search_before_review: true, contacts_without_tap: false }, error: null });
    expect(await fetchSiteSettings(service as never)).toEqual({ search_before_review: true, contacts_without_tap: false });
    expect(service.from).toHaveBeenCalledWith("site_settings");
  });

  it("reads as both off when the table is missing (code deployed before the migration), the row is gone or the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await fetchSiteSettings(reading({ data: null, error: { code: "42P01" } }) as never)).toEqual(ALL_OFF);
    expect(await fetchSiteSettings(reading({ data: null, error: null }) as never)).toEqual(ALL_OFF);
  });

  it("opens a switch only for exactly true", async () => {
    const service = reading({ data: { search_before_review: "true", contacts_without_tap: 1 }, error: null });
    expect(await fetchSiteSettings(service as never)).toEqual(ALL_OFF);
  });
});

describe("contactsInline", () => {
  const on = { ...ALL_OFF, contacts_without_tap: true };
  it("is for an accepted doctor or an admin, and only while the switch is open", () => {
    expect(contactsInline(on, { is_admin_approved: true, is_admin: false })).toBe(true);
    expect(contactsInline(on, { is_admin_approved: false, is_admin: true })).toBe(true);
    expect(contactsInline(ALL_OFF, { is_admin_approved: true, is_admin: false })).toBe(false);
  });

  it("is never for an account still in review, even when the other switch lets it search", () => {
    expect(contactsInline({ search_before_review: true, contacts_without_tap: true }, { is_admin_approved: false, is_admin: false })).toBe(false);
  });
});
