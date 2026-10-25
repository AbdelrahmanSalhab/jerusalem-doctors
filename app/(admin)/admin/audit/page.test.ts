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
  institutions: [{ id: "i1", name_ar: "المقاصد" }],
  doctors: [
    { id: "d1", arabic_first_name: "ليلى", arabic_family_name: "الخطيب" },
    { id: "a1", arabic_first_name: "خالد", arabic_family_name: "سلهب" },
  ],
};

/** The arguments of every admin_audit_events call. */
const calls: Record<string, unknown>[] = [];
let rows: typeof ROWS = ROWS;

vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn(async () => ({ id: "a1" })) }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== "admin_audit_events") throw new Error(name);
      calls.push(args);
      return { data: rows.map((r) => ({ ...r, total: 120 })), error: null };
    },
    from(table: string) {
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: DATA[table], error: null }).then(ok),
      };
      for (const m of ["select", "in"]) chain[m] = () => chain;
      return chain;
    },
  }),
}));

describe("/admin/audit", () => {
  it("reads like a log an admin understands", async () => {
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("تسجيل جديد");
    expect(html).toContain("ليلى الخطيب");
    expect(html).toContain("فُعّل تلقائيًا");
    expect(html).toContain("«المقاصد» · طرق الكتابة: مقاصد");
    expect(html).toContain("خالد سلهب");
    expect(html).toContain("حساب محذوف");
    expect(html).toContain("النظام");
    expect(html).toContain("19/10/2026 11:53");
    // Codes and ids show only inside the collapsed developer section (the
    // event filter keeps codes as option values, never as text).
    expect(html.indexOf(">signup_verified<")).toBeGreaterThan(html.indexOf("للمطوّرين"));
    expect(html).toContain("الوقت الدقيق");
    expect(html).toContain("19/10/2026 11:53:17");
    expect(html).toContain("فتح الطبيب في قائمة الأطباء");
    expect(html).toContain('href="/admin?doctor=d1"');
    expect(html).not.toContain("9.9.9.9");
    expect(html).not.toContain("auto_approved");
    expect(html).toContain("120 حدثًا في السجل");
    expect(html).toContain("الصفحة 1 من 3");
    expect(html).not.toContain("السابق");
    expect(html).toContain('href="/admin/audit?page=2"');
  });

  it("pages through every entry, 50 at a time", async () => {
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ page: "2" }) }));
    expect(calls.at(-1)).toMatchObject({ p_limit: 50, p_offset: 50 });
    expect(html).toContain("الصفحة 2 من 3");
    expect(html).toContain('href="/admin/audit"');
    expect(html).toContain('href="/admin/audit?page=3"');
  });

  it("treats a junk page number as the first page", async () => {
    const { default: Page } = await import("./page");
    await Page({ searchParams: Promise.resolve({ page: "-4x" }) });
    expect(calls.at(-1)).toMatchObject({ p_offset: 0 });
  });

  it("sends the filters to the database, and pages keep them", async () => {
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(
      await Page({
        searchParams: Promise.resolve({ action: "signup_verified", q: "ليلى", from: "2026-10-01", to: "2026-10-19", people: "1" }),
      }),
    );
    expect(calls.at(-1)).toEqual({
      p_action: "signup_verified",
      // Normalised the same way as the stored names.
      p_term: "ليلي",
      p_from: "2026-10-01",
      p_to: "2026-10-19",
      p_people_only: true,
      p_limit: 50,
      p_offset: 0,
    });
    expect(html).toContain("120 حدثًا تطابق التصفية");
    expect(html).toContain('href="/admin/audit?action=signup_verified&amp;q=%D9%84%D9%8A%D9%84%D9%89&amp;from=2026-10-01&amp;to=2026-10-19&amp;people=1&amp;page=2"');
    expect(html).toContain(">مسح<");
  });

  it("sends nothing for an unknown event, a malformed date or a search of only symbols", async () => {
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ action: "drop_table", from: "2026-02-31", q: "%_*" }) }));
    expect(calls.at(-1)).toMatchObject({ p_action: undefined, p_from: undefined, p_term: undefined });
    expect(html).toContain("120 حدثًا تطابق التصفية");
  });

  it("says when nothing matches", async () => {
    const { default: Page } = await import("./page");
    rows = [];
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: "لا أحد" }) }));
    rows = ROWS;
    expect(html).toContain("0 أحداث تطابق التصفية");
    expect(html).toContain("لا أحداث تطابق التصفية.");
  });
});
