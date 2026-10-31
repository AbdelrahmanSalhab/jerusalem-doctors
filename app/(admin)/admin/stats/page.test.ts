// Renders /admin/stats from a realistic admin_stats() payload, so a missing
// field or a bad calculation fails here instead of on the live admin page.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminStats } from "@/lib/adminStats";

const SAMPLE: AdminStats = {
  generated_at: "2026-10-19T09:00:00Z",
  doctors: {
    total: 40, listed: 31, pending: 3, suspended: 2, new_24h: 4, new_7d: 12, new_30d: 40,
    seeking_work: 5, retired: 3, with_photo: 18, with_bio: 22, with_workplace: 37, approved_auto: 30, approved_manual: 5,
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

const METRICS = [
  { day: "2026-10-20", db_bytes: 13_631_488, counts: { searches: 41, sms_sent: 12, logins: 5, registry_requests: 2 } },
  { day: "2026-10-19", db_bytes: 13_000_000, counts: { searches: 30, sms_sent: 25, logins: 4 } },
];
// install_funnel(30): a doctor on an iPhone who opened the installed app.
const FUNNEL = [
  { kind: "install_invite_shown", platform: "iphone", events: 3, doctors: 2 },
  { kind: "install_invite_shown", platform: null, events: 3, doctors: 2 },
  { kind: "install_app_opened", platform: "iphone", events: 4, doctors: 1 },
  { kind: "install_app_opened", platform: null, events: 4, doctors: 1 },
];
// otp_stats(7): a late text, refused codes, and one doctor stuck at sign-in.
const OTP = {
  sent: 12, send_ms_p50: 900, send_ms_max: 2400, delivered: 10, undelivered: 1, voice: 1,
  delay_p50: 6, delay_max: 95, late: 2, refused: 4, locked: 1, resent: 3, logins_ok: 5,
  signups_started: 4, stuck_signups: 1,
  failed: 3,
  failed_by_reason: [{ reason: "sms4free_status_-4", n: 2 }, { reason: "daily_cap", n: 1 }],
  recent_failures: [{ at: "2026-10-30T11:00:00Z", reason: "sms4free_status_-4", name: "سامر خوري", signup: null }],
  stuck_logins: [{ id: "d1", name: "ليلى الخطيب", refused: 2, last_at: "2026-10-27T10:00:00Z" }],
};
vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn(async () => ({ id: "a1" })) }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    rpc: vi.fn(async (name: string) => ({
      data: name === "install_funnel" ? FUNNEL : name === "otp_stats" ? OTP : SAMPLE,
      error: null,
    })),
    // metrics_daily, newest first.
    from: () => {
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: METRICS, error: null }).then(ok),
      };
      for (const m of ["select", "order", "limit"]) chain[m] = () => chain;
      return chain;
    },
  }),
}));
vi.mock("@/lib/otp/sms4free", () => ({ fetchAvailableSms: vi.fn(async () => 120) }));

describe("/admin/stats", () => {
  it("renders every section with counts and shares", async () => {
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("يحتاج انتباهك");
    // Measured usage against the free-plan limits.
    expect(html).toContain("الاستخدام الفعلي");
    expect(html).toContain("13.0 MB");
    expect(html).toContain("3٪ من 500.0 MB");
    expect(html).toContain("من حد يومي 200");
    expect(html).toContain("2026-10-20");
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
    // The code step: delivery, refusals, and who is stuck.
    expect(html).toContain("رموز التحقق (آخر 7 أيام)");
    expect(html).toContain("عادةً خلال 6 ث، أبطؤها 95 ث");
    expect(html).toContain("د. ليلى الخطيب: رُفض رمزه مرتين، ولم يدخل بعدها");
    expect(html).toContain("نفد رصيد الرسائل: اشحنه: 2");
    expect(html).toContain("د. سامر خوري");
    expect(html).toContain("1 تسجيل رُفض رمزه ولم يكتمل");
    // Install funnel: doctors per step, by platform and in all.
    expect(html).toContain("الإضافة إلى الشاشة الرئيسية");
    expect(html).toMatch(/فتحوه من الشاشة الرئيسية<\/th><td class="px-3 py-2">1<\/td>/);
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
