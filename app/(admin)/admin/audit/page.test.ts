// The activity log shows names, Arabic events and readable details, never
// raw ids, codes or the IP stored with a deletion request.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const ROWS = [
  { id: "1", action: "signup_verified", actor_doctor_id: "d1", target_doctor_id: "d1", metadata: { auto_approved: true, license_status: "verified" }, created_at: "2026-10-19T08:53:17Z" },
  { id: "2", action: "institution_updated", actor_doctor_id: "a1", target_doctor_id: null, metadata: { id: "i1", aliases: ["مقاصد"], linked: 1 }, created_at: "2026-10-19T05:50:31Z" },
  { id: "3", action: "delete_requested", actor_doctor_id: "gone", target_doctor_id: "gone", metadata: { ip: "9.9.9.9" }, created_at: "2026-10-18T10:00:00Z" },
  { id: "4", action: "moh_sync_completed", actor_doctor_id: null, target_doctor_id: null, metadata: { rows_upserted: 63000, duration_ms: 41000 }, created_at: "2026-10-18T00:00:00Z" },
];
const DATA: Record<string, unknown[]> = {
  audit_logs: ROWS,
  institutions: [{ id: "i1", name_ar: "المقاصد" }],
  doctors: [
    { id: "d1", arabic_first_name: "ليلى", arabic_family_name: "الخطيب" },
    { id: "a1", arabic_first_name: "خالد", arabic_family_name: "سلهب" },
  ],
};

vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn(async () => ({ id: "a1" })) }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: DATA[table], error: null }).then(ok),
      };
      for (const m of ["select", "order", "limit", "in"]) chain[m] = () => chain;
      return chain;
    },
  }),
}));

describe("/admin/audit", () => {
  it("reads like a log an admin understands", async () => {
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("تسجيل جديد");
    expect(html).toContain("ليلى الخطيب");
    expect(html).toContain("فُعّل تلقائيًا");
    expect(html).toContain("«المقاصد» · طرق الكتابة: مقاصد");
    expect(html).toContain("خالد سلهب");
    expect(html).toContain("حساب محذوف");
    expect(html).toContain("النظام");
    expect(html).toContain("19/10/2026 11:53");
    // Codes and ids only inside the collapsed developer section.
    expect(html.indexOf("signup_verified")).toBeGreaterThan(html.indexOf("للمطوّرين"));
    expect(html).toContain("الوقت الدقيق");
    expect(html).toContain("19/10/2026 11:53:17");
    expect(html).toContain("فتح الطبيب في قائمة الأطباء");
    expect(html).not.toContain("9.9.9.9");
    expect(html).not.toContain("auto_approved");
  });
});
