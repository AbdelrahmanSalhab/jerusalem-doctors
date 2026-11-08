// The directory's two switches (/admin/settings), each off unless an admin
// turned it on. Off is the behaviour #16 set: a doctor not yet accepted cannot
// search, and a colleague's number and email come after a tap. A switch gives
// one of those up on purpose, so anything unreadable here reads as off.

import type { SupabaseClient } from "@supabase/supabase-js";

export const SETTING_KEYS = ["search_before_review", "contacts_without_tap"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type SiteSettings = Record<SettingKey, boolean>;

/** Both off: today's behaviour, and what a failed read falls back to. */
export const ALL_OFF: SiteSettings = { search_before_review: false, contacts_without_tap: false };

export function isSettingKey(v: unknown): v is SettingKey {
  return typeof v === "string" && (SETTING_KEYS as readonly string[]).includes(v);
}

/** The row, or both off when it cannot be read (the migration not run yet,
 *  a database error): code ahead of the database stays as protective as it was. */
export async function fetchSiteSettings(service: SupabaseClient): Promise<SiteSettings> {
  const { data, error } = await service.from("site_settings").select(SETTING_KEYS.join(", ")).maybeSingle();
  if (error) console.error("[settings] read failed, both switches read as off", error);
  const row = (data ?? {}) as Partial<Record<SettingKey, unknown>>;
  return {
    search_before_review: row.search_before_review === true,
    contacts_without_tap: row.contacts_without_tap === true,
  };
}

/** Whether this viewer's cards carry numbers and emails without a tap: the
 *  switch is on and the viewer is an accepted doctor or an admin. An account
 *  still in review keeps the tap, and with it the small daily limit
 *  (lib/contactBudget.ts), even when it may search. */
export function contactsInline(
  settings: SiteSettings,
  viewer: { is_admin_approved: boolean; is_admin: boolean },
): boolean {
  return settings.contacts_without_tap && (viewer.is_admin_approved || viewer.is_admin);
}
