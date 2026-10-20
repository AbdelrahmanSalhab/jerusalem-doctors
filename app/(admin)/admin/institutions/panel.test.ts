// The institutions tab hosts the doctor panel itself, so an admin working
// through the unlinked names never loses their place: opening a doctor and
// closing them again both stay on /admin/institutions.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads: string[] = [];

const DOCTOR = {
  id: "d1",
  arabic_first_name: "ليلى",
  arabic_family_name: "الخطيب",
  arabic_full_name: "ليلى الخطيب",
  hebrew_first_name: "לילא",
  hebrew_family_name: "אלכטיב",
  phone_e164: "+972501112233",
  phone_display: "050-111-2233",
  email: "laila@example.com",
  bio: "طبيبة أطفال",
  subspecialty: null,
  certificates: [],
  profile_picture_url: null,
  career_stage: "specialist",
  residency_start_year: null,
  license_number: "189371",
  license_region: "IL",
  license_verification_status: "verified",
  license_verified_at: "2026-09-01T10:00:00Z",
  secondary_license_number: null,
  secondary_license_region: null,
  secondary_license_verification_status: null,
  is_admin_approved: true,
  is_active: true,
  is_visible: true,
  is_phone_verified: true,
  is_admin: false,
  consent_directory_use: true,
  consent_timestamp: "2026-08-01T10:00:00Z",
  seeking_work: false,
  featured: null,
  featured_at: null,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  auth_user_id: null,
};

const DATA: Record<string, unknown[]> = {
  institutions: [{ id: "i1", name_ar: "هداسا", name_he: "הדסה", kind: "hospital", aliases: [] }],
  doctor_workplaces: [{ doctor_id: "d1", name: "القدس", workplace_type: "hospital", institution_id: null }],
  doctors: [{ id: "d1", arabic_first_name: "ليلى", arabic_family_name: "الخطيب" }],
  specialties: [{ id: "s1", name_ar: "طب الأطفال", code: "peds", parent_id: null }],
  doctor_specialties: [{ specialty_id: "s1", specialty: { name_ar: "طب الأطفال" } }],
  audit_logs: [],
};

vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn(async () => ({ id: "a1" })) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/institutions",
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      reads.push(table);
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: DATA[table] ?? [], error: null }).then(ok),
      };
      for (const m of ["select", "eq", "order", "range", "in", "limit"]) {
        chain[m] = () => chain;
      }
      chain.maybeSingle = () =>
        Promise.resolve({ data: table === "doctors" ? DOCTOR : null, error: null });
      return chain;
    },
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: null } })) } },
  }),
}));

const render = async (searchParams: Record<string, string> = {}) => {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
};

beforeEach(() => {
  reads.length = 0;
});

describe("/admin/institutions, the doctor panel", () => {
  it("stays shut, and reads no catalogue, with no ?doctor=", async () => {
    const html = await render();
    expect(html).not.toContain('role="dialog"');
    expect(reads).not.toContain("specialties");
  });

  it("opens over the institutions list and closes back to it", async () => {
    const html = await render({ doctor: "d1" });
    expect(html).toContain('role="dialog"');
    expect(html).toContain("ليلى الخطيب");
    // The way into the editor, on this tab.
    expect(html).toContain('href="/admin/institutions?doctor=d1&amp;edit=1"');
    // Read-only until then: no catalogue fetched, no form.
    expect(reads).not.toContain("specialties");
  });

  it("shows the editor, and loads the specialties it needs, with edit=1", async () => {
    const html = await render({ doctor: "d1", edit: "1" });
    expect(html).toContain("تعديل ملف");
    expect(html).toContain("حفظ الملف");
    // The fields a doctor cannot change for themselves are here.
    expect(html).toContain("اسم العائلة بالعبرية");
    expect(html).toContain("رقم الهاتف هو هوية الدخول");
    expect(html).toContain("050-111-2233");
    expect(reads).toContain("specialties");
  });
});
