// The doctors list opens on everyone, marks who is waiting, and the panel
// shows the whole record with the three switches spelled out.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Call {
  table: string;
  method: string;
  args: unknown[];
}

const calls: Call[] = [];

const DOCTOR = {
  id: "00000000-0000-4000-8000-0000000000d1",
  arabic_first_name: "ليلى",
  arabic_family_name: "الخطيب",
  arabic_full_name: "ليلى الخطيب",
  hebrew_first_name: "לילא",
  hebrew_family_name: "אלכטיב",
  phone_e164: "+972501112233",
  phone_display: "050-111-2233",
  email: "laila@example.com",
  bio: "طبيبة أطفال",
  subspecialty: "حساسية الأطفال",
  certificates: ["تخطيط قلب"],
  profile_picture_url: null,
  career_stage: "specialist",
  residency_start_year: null,
  license_number: "189371",
  license_region: "IL",
  license_verification_status: "soft_match",
  license_verified_at: "2026-09-01T10:00:00Z",
  secondary_license_number: null,
  secondary_license_region: null,
  secondary_license_verification_status: null,
  is_admin_approved: false,
  is_active: true,
  is_visible: true,
  is_phone_verified: true,
  is_admin: false,
  consent_directory_use: true,
  consent_timestamp: "2026-08-01T10:00:00Z",
  seeking_work: false,
  retired: false,
  featured: null,
  featured_at: null,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  auth_user_id: null,
  doctor_specialties: [{ specialty: { name_ar: "طب الأطفال" } }],
};

/** What each table answers, in the order the page asks. */
const DATA: Record<string, unknown> = {};

let listError: { code: string } | null = null;

vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn(async () => ({ id: "a1" })) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  }),
  // The list and panel are client components; static rendering only needs
  // these to exist.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin",
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({
            data: DATA[table] ?? [],
            error: table === "doctors" ? listError : null,
            count: table === "doctors" ? 60 : null,
          }).then(ok),
      };
      for (const m of ["select", "eq", "or", "not", "order", "range", "in", "limit", "maybeSingle"]) {
        chain[m] = (...args: unknown[]) => {
          calls.push({ table, method: m, args });
          // Two different reads end in maybeSingle: the panel's doctor, and
          // when the registry copy was last synced.
          if (m === "maybeSingle") {
            const row = table === "doctors" ? DATA.doctor_detail : DATA.sync_row;
            return Promise.resolve({ data: row ?? null, error: null });
          }
          return chain;
        };
      }
      return chain;
    },
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: null } })) } },
  }),
}));

const render = async (searchParams: Record<string, string> = {}) => {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
};

const eqArgs = () => calls.filter((c) => c.table === "doctors" && c.method === "eq").map((c) => c.args);

beforeEach(() => {
  calls.length = 0;
  listError = null;
  DATA.doctors = [DOCTOR];
  DATA.doctor_detail = null;
  DATA.doctor_specialties = [];
  DATA.doctor_workplaces = [];
  DATA.audit_logs = [];
  DATA.moh_practitioners = [];
  DATA.sync_row = { created_at: "2026-10-19T03:00:00Z" };
});

describe("/admin doctors list", () => {
  it("lists every doctor by default, not just the ones waiting", async () => {
    const html = await render();
    expect(html).toContain("ليلى الخطيب");
    // The list query must not narrow by approval. The filter counts do use eq,
    // so only the id-filtering of the list itself is checked here.
    expect(eqArgs()).not.toContainEqual(["id", expect.anything()]);
    expect(html).toContain("كل الحسابات");
    // The admins who are not doctors are named, so the total can differ from /admin/stats.
    expect(html).toContain("منها 60 من الإدارة وليسوا أطباء");
  });

  it("counts every filter with the filter's own conditions", async () => {
    await render();
    const heads = calls.filter((c) => c.table === "doctors" && c.method === "select" && JSON.stringify(c.args).includes('"head":true'));
    // The eight filters, and the admins who are not doctors.
    expect(heads).toHaveLength(10);
    expect(eqArgs()).toEqual(expect.arrayContaining([["clinic_missing_details", true], ["career_stage", "resident"], ["is_admin", true]]));
  });

  it("counts what is in the filter, in Arabic", async () => {
    expect(await render()).toContain("60 طبيبًا في هذا التصنيف");
  });

  it("marks a doctor who is waiting for a decision", async () => {
    const html = await render();
    expect(html).toContain("بانتظار القبول");
    // The row opens the panel to review the doctor; it does not accept on its own.
    expect(html).toContain("مراجعة وقبول");
    expect(html).not.toContain("قبول العضوية");
  });

  it("shows the licence verdict on the row", async () => {
    expect(await render()).toContain("تطابق جزئي");
  });

  it("narrows to open accounts only when asked for the queue", async () => {
    await render({ status: "pending" });
    expect(eqArgs()).toContainEqual(["is_admin_approved", false]);
    expect(eqArgs()).toContainEqual(["is_active", true]);
  });

  // Non-doctor admins are hidden on purpose and hold no real licence.
  it("leaves non-doctor admin rows out of the hidden and licence filters", async () => {
    await render({ status: "hidden" });
    expect(eqArgs()).toContainEqual(["is_admin", false]);
    calls.length = 0;
    await render({ status: "license" });
    const ors = calls.filter((c) => c.table === "doctors" && c.method === "or").map((c) => String(c.args[0]));
    expect(ors).toContain(
      "and(or(license_verification_status.is.null,license_verification_status.neq.verified),license_reviewed_at.is.null,or(is_admin.eq.false,is_visible.eq.true))",
    );
  });

  it("lists accepted, open, real doctors that no admin has reviewed the identity of", async () => {
    await render({ status: "identity" });
    expect(eqArgs()).toContainEqual(["is_admin_approved", true]);
    expect(eqArgs()).toContainEqual(["is_active", true]);
    const ors = calls.filter((c) => c.table === "doctors" && c.method === "or").map((c) => String(c.args[0]));
    expect(ors).toContain("and(identity_reviewed_at.is.null,or(is_admin.eq.false,is_visible.eq.true))");
  });

  it("finds residents whose licence the registry lists with a specialty", async () => {
    await render({ status: "stage" });
    expect(eqArgs()).toContainEqual(["career_stage", "resident"]);
    const nots = calls.filter((c) => c.table === "doctors" && c.method === "not").map((c) => c.args);
    expect(nots).toContainEqual(["registry_specialty", "is", null]);
  });

  it("finds doctors with a clinic missing its address or phone", async () => {
    await render({ status: "clinic" });
    expect(eqArgs()).toContainEqual(["clinic_missing_details", true]);
    const ors = calls.filter((c) => c.table === "doctors" && c.method === "or").map((c) => String(c.args[0]));
    expect(ors).toContain("is_admin.eq.false,is_visible.eq.true");
  });

  it("asks for the right slice of rows on a later page", async () => {
    await render({ page: "3" });
    const ranges = calls.filter((c) => c.table === "doctors" && c.method === "range").map((c) => c.args);
    expect(ranges).toContainEqual([50, 74]);
  });

  it("sends an out-of-range page back to the first one", async () => {
    listError = { code: "PGRST103" };
    await expect(render({ page: "99" })).rejects.toThrow("redirect:/admin");
  });

  it("says so when the list cannot be read", async () => {
    listError = { code: "42P01" };
    expect(await render()).toContain("تعذّر تحميل القائمة");
  });

  it("keeps the filter and search in the paging and chip links", async () => {
    const html = await render({ status: "pending", q: "ليلى" });
    expect(html).toContain("status=pending");
  });
});

describe("/admin doctor panel", () => {
  beforeEach(() => {
    DATA.doctor_detail = DOCTOR;
    DATA.moh_practitioners = [
      {
        license_number: 189371,
        hebrew_first_name: "לילא",
        // One letter off the doctor's stored spelling: a partial match.
        hebrew_family_name: "אלחטיב",
        hebrew_first_norm: "לילא",
        hebrew_family_norm: "אלחטיב",
        specialty_name_he: "ילדים",
        license_issued_yyyymmdd: 20110503,
        synced_at: "2026-10-19T03:00:00Z",
      },
    ];
  });

  const ROWS = ["d1", "d2", "d3"].map((n) => ({ ...DOCTOR, id: `00000000-0000-4000-8000-0000000000${n}` }));
  const href = (html: string, label: string) => html.match(new RegExp(`href="([^"]*)"[^>]*>${label}<`))?.[1];

  it("steps to the doctors either side in the list, and keeps the filter", async () => {
    DATA.doctors = ROWS;
    DATA.doctor_detail = ROWS[1];
    const html = await render({ status: "pending", doctor: ROWS[1].id });
    expect(href(html, "السابق")).toContain(`doctor=${ROWS[0].id}`);
    expect(href(html, "التالي")).toContain(`doctor=${ROWS[2].id}`);
    expect(href(html, "التالي")).toContain("status=pending");
  });

  it("has nothing before the first doctor and nothing after the last", async () => {
    DATA.doctors = ROWS;
    DATA.doctor_detail = ROWS[0];
    expect(href(await render({ doctor: ROWS[0].id }), "السابق")).toBeUndefined();
    DATA.doctor_detail = ROWS[2];
    expect(href(await render({ doctor: ROWS[2].id }), "التالي")).toBeUndefined();
  });

  it("goes on to the first of the list once the open doctor has left it", async () => {
    // Accepted from the waiting list: the refreshed list no longer holds them.
    DATA.doctors = ROWS.slice(1);
    DATA.doctor_detail = ROWS[0];
    const html = await render({ status: "pending", doctor: ROWS[0].id });
    expect(href(html, "التالي")).toContain(`doctor=${ROWS[1].id}`);
    expect(href(html, "السابق")).toBeUndefined();
  });

  it("puts the record before the switches for a doctor who waits, with the accept bar at the foot", async () => {
    const html = await render({ doctor: DOCTOR.id });
    expect(html.indexOf("التحقق من الترخيص")).toBeLessThan(html.indexOf("المرحلة المهنية"));
    expect(html.indexOf("الحذف النهائي")).toBeGreaterThan(html.indexOf("آخر الأحداث"));
    // The bar itself (the switch of the same name is not it): last in the panel, after the delete section.
    expect(html.indexOf("sticky bottom-0")).toBeGreaterThan(html.indexOf("الحذف النهائي"));
    expect(html.indexOf("بانتظار القبول</span><button")).toBeGreaterThan(html.indexOf("sticky bottom-0"));
  });

  it("keeps the switches first for a doctor who is already in", async () => {
    DATA.doctor_detail = { ...DOCTOR, is_admin_approved: true };
    const html = await render({ doctor: DOCTOR.id });
    expect(html.indexOf("المرحلة المهنية")).toBeLessThan(html.indexOf("التحقق من الترخيص"));
    // No bar for a doctor who is already in.
    expect(html).not.toContain("sticky bottom-0");
  });

  it("explains why the licence only partly matched, naming the rule", async () => {
    const html = await render({ doctor: "00000000-0000-4000-8000-0000000000d1" });
    expect(html).toContain("التحقق من الترخيص");
    expect(html).toContain("الرقم مطابق، لكن كتابة الاسم تختلف قليلًا عن السجل.");
    expect(html).toContain("حرف واحد فقط يختلف");
    // The registry's own spelling, which signup showed once and never kept.
    expect(html).toContain("אלחטיב");
  });

  it("admits when the reasoning is re-derived rather than recorded", async () => {
    const html = await render({ doctor: "00000000-0000-4000-8000-0000000000d1" });
    expect(html).toContain("محسوبة الآن من نسخة السجل الحالية");
  });

  it("names the three switches apart and says what each does", async () => {
    const html = await render({ doctor: "00000000-0000-4000-8000-0000000000d1" });
    for (const label of ["قبول العضوية", "الحساب", "الظهور في الدليل"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("لا يستطيع الدخول نهائيًا");
    expect(html).toContain("لا يراه الأطباء في البحث");
    expect(html).not.toContain("إلغاء التفعيل");
    expect(html).not.toContain("تعليق");
  });

  it("answers whether the doctor is actually in the directory", async () => {
    const html = await render({ doctor: "00000000-0000-4000-8000-0000000000d1" });
    expect(html).toContain("لا يظهر في الدليل الآن");
    expect(html).toContain("لم تُقبل عضويته بعد");
  });

  it("shows everything a colleague would see, and more", async () => {
    const html = await render({ doctor: "00000000-0000-4000-8000-0000000000d1" });
    for (const fragment of [
      "laila@example.com",
      "طبيبة أطفال",
      "حساسية الأطفال",
      "تخطيط قلب",
      "050-111-2233",
      "לילא",
    ]) {
      expect(html).toContain(fragment);
    }
  });

  it("offers no permanent delete while the account is open", async () => {
    const html = await render({ doctor: "00000000-0000-4000-8000-0000000000d1" });
    expect(html).toContain("أغلق الحساب أولًا");
  });

  it("says the account is gone rather than failing the page", async () => {
    DATA.doctor_detail = null;
    const html = await render({ doctor: "missing" });
    expect(html).toContain("هذا الحساب غير موجود");
  });

  it("treats a malformed id as not found instead of failing the read", async () => {
    const html = await render({ doctor: "abc" });
    expect(html).toContain("هذا الحساب غير موجود");
  });
});
