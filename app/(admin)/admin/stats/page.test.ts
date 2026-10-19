// Renders /admin/stats from a realistic admin_stats() payload, so a missing
// field or a bad calculation fails here instead of on the live admin page.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminStats } from "@/lib/adminStats";

const SAMPLE: AdminStats = {
  generated_at: "2026-10-19T09:00:00Z",
  doctors: {
    total: 40, listed: 31, pending: 3, suspended: 2, new_24h: 4, new_7d: 12, new_30d: 40,
    seeking_work: 5, with_photo: 18, with_bio: 22, with_workplace: 37, approved_auto: 30, approved_manual: 5,
  },
  stage: { general: 10, resident: 12, specialist: 18 },
  license: { il_only: 25, ps_only: 9, both: 6, verified: 30, soft_match: 2, not_found: 7, mismatch_overridden: 1 },
  activity: { active_7d: 20, active_30d: 33, never: 3 },
  daily: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, signups: i % 4, searchers: i % 6, contacts: i % 3 })),
  contacts: { whatsapp_7d: 31, call_7d: 12, save_7d: 5, contacters_7d: 14, contacted_7d: 22 },
  heavy_contacters: [{ name: "حساب مريب", count: 27 }],
  domains: [{ name: "الباطنية", count: 9 }, { name: "طب الأطفال", count: 6 }],
  workplace_types: { hospital: 28, clinic: 14, hmo: 6 },
  institutions: [{ name: "المقاصد", kind: "hospital", count: 11 }, { name: "كلاليت", kind: "hmo", count: 14 }],
  attention: {
    pending: 3, pending_oldest: "2026-10-15T09:00:00Z", pending_not_found: 2, pending_mismatch: 1,
    deletion_requests: 1, deletion_oldest: "2026-10-18T09:00:00Z", clinics: 14, clinics_missing_details: 4, never_logged_in: 3,
    unmatched_workplaces: 2,
  },
  usage: {
    searchers_7d: 15, searches_7d: 140, filter_empty_7d: 6, signup_started_7d: 15, login_code_sent_7d: 50,
    login_succeeded_7d: 44, login_unregistered_7d: 7, login_send_failed_24h: 0, since: "2026-09-01T00:00:00Z",
  },
  signup_completed_7d: 12,
  empty_specialties: [{ name: "القلب", count: 4 }],
  moh_sync: { action: "moh_sync_completed", at: "2026-10-19T03:00:00Z" },
};

vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn(async () => ({ id: "a1" })) }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ rpc: vi.fn(async () => ({ data: SAMPLE, error: null })) }),
}));
vi.mock("@/lib/otp/sms4free", () => ({ fetchAvailableSms: vi.fn(async () => 120) }));

describe("/admin/stats", () => {
  it("renders every section with counts and shares", async () => {
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("يحتاج انتباهك");
    expect(html).toContain("120"); // low SMS credit is flagged
    expect(html).toContain("فلسطيني فقط");
    expect(html).toContain("9 · 23%"); // 9 of 40 PS-only
    expect(html).toContain("80%"); // 12 of 15 signups completed
    expect(html).toContain("القلب");
    expect(html).toContain("نجحت");
    expect(html).toContain("كلاليت");
    expect(html).toContain("رسائل واتساب");
    expect(html).toContain("مع 22 زميلًا");
    expect(html).toContain("حساب مريب");
    expect(html).toContain("/admin/institutions");
  });
});

describe("/admin/stats with no activity yet", () => {
  it("labels an empty month's peak as 0, not 1", async () => {
    const { DailyBars } = await import("./StatsParts");
    const html = renderToStaticMarkup(
      DailyBars({ label: "أطباء بحثوا", days: [{ day: "2026-10-18", value: 0 }, { day: "2026-10-19", value: 0 }] }),
    );
    expect(html).toContain("أعلى يوم 0");
  });
});

describe("/admin/stats in the first week of counting", () => {
  it("hides the signup completion share until starts cover 7 days", async () => {
    const { default: Page } = await import("./page");
    SAMPLE.usage.since = new Date().toISOString();
    const html = renderToStaticMarkup(await Page());
    SAMPLE.usage.since = "2026-09-01T00:00:00Z";
    expect(html).not.toContain("ممن بدأوا");
  });
});
