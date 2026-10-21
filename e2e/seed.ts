// Resets the local database to a known set of doctors before a test run.
// Every row here is synthetic; this never runs against production (it
// refuses any URL that is not the local stack).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { toRegistryRows } from "@/lib/moh/registry";
import registry from "./registry.json";
import { ACCOUNTS, PASSWORD, SERVICE_ROLE_KEY, SUPABASE_URL, type Role } from "./env";

type Stage = "resident" | "specialist" | null;

interface Workplace {
  name: string;
  type: "hospital" | "clinic" | "hmo";
  address?: string;
  hours?: string;
  phone?: string;
}

export interface SeedDoctor {
  key: string;
  first: string;
  family: string;
  hebrewFirst: string;
  hebrewFamily: string;
  phone: string;
  license: string;
  stage: Stage;
  residencyYear?: number;
  specialties: string[];
  workplaces: Workplace[];
  email?: string;
  account?: Role;
  /** A sign-in for a test-owned doctor (an address in THROWAWAY_ACCOUNTS). */
  loginEmail?: string;
  bio?: string;
  seekingWork?: boolean;
  featured?: "doctor" | "graduate";
  visible?: boolean;
  approved?: boolean;
  admin?: boolean;
  licenseStatus?: string;
  certificates?: string[];
}

export const DOCTORS: SeedDoctor[] = [
  {
    key: "samer",
    account: "doctor",
    first: "سامر",
    family: "ناصر",
    hebrewFirst: "סאמר",
    hebrewFamily: "נאסר",
    phone: "+972521234501",
    license: "510002",
    stage: "specialist",
    specialties: ["القلب"],
    workplaces: [
      { name: "المقاصد", type: "hospital" },
      { name: "عيادة القلب في بيت حنينا", type: "clinic", address: "شارع بيت حنينا الرئيسي 12", hours: "الأحد إلى الخميس 16:00 إلى 20:00", phone: "02-6271234" },
    ],
    email: "samer@example.test",
    bio: "أخصائي أمراض القلب.",
  },
  {
    key: "laila",
    first: "ليلى",
    family: "الخطيب",
    hebrewFirst: "ליילא",
    hebrewFamily: "אלח'טיב",
    phone: "+972521234502",
    license: "510001",
    stage: "specialist",
    specialties: ["الأطفال"],
    workplaces: [{ name: "هداسا عين كارم", type: "hospital" }],
    featured: "doctor",
    certificates: ["تخطيط قلب"],
  },
  {
    key: "yousef",
    first: "يوسف",
    family: "حداد",
    hebrewFirst: "יוסף",
    hebrewFamily: "חדאד",
    phone: "+972521234503",
    license: "510003",
    stage: null,
    specialties: ["الطب العام"],
    workplaces: [],
    seekingWork: true,
    featured: "graduate",
  },
  {
    key: "mariam",
    first: "مريم",
    family: "عودة",
    hebrewFirst: "מרים",
    hebrewFamily: "עודה",
    phone: "+972521234504",
    license: "510004",
    stage: "resident",
    residencyYear: 2023,
    specialties: ["الأطفال"],
    workplaces: [{ name: "المطّلع (أوغستا فكتوريا)", type: "hospital" }],
    licenseStatus: "not_found",
  },
  {
    key: "hidden",
    first: "خفي",
    family: "المخفي",
    hebrewFirst: "חפי",
    hebrewFamily: "אלמחפי",
    phone: "+972521234505",
    license: "510005",
    stage: "specialist",
    specialties: ["العيون"],
    workplaces: [{ name: "مستشفى العيون سانت جون", type: "hospital" }],
    visible: false,
  },
  {
    key: "pending",
    account: "pending",
    first: "منتظر",
    family: "القبول",
    hebrewFirst: "מונתזר",
    hebrewFamily: "אלקבול",
    phone: "+972521234506",
    license: "510010",
    stage: "specialist",
    specialties: ["العظام"],
    workplaces: [{ name: "المقاصد", type: "hospital" }],
    approved: false,
  },
  {
    key: "closed",
    account: "closed",
    first: "مغلق",
    family: "الحساب",
    hebrewFirst: "מוע'לק",
    hebrewFamily: "אלחסאב",
    phone: "+972521234507",
    license: "510011",
    stage: "specialist",
    specialties: ["الباطنية"],
    workplaces: [{ name: "المقاصد", type: "hospital" }],
  },
  {
    // A non-doctor admin, hidden on purpose like the real ones.
    key: "admin",
    account: "admin",
    first: "مدير",
    family: "النظام",
    hebrewFirst: "מודיר",
    hebrewFamily: "אלנט'אם",
    phone: "+972521234508",
    license: "200099",
    stage: null,
    specialties: ["الطب العام"],
    workplaces: [],
    admin: true,
    visible: false,
  },
];

/** Names the directory must show, and names it must never show. */
export const LISTED = ["سامر ناصر", "ليلى الخطيب", "يوسف حداد", "مريم عودة"];
export const NEVER_LISTED = ["خفي المخفي", "منتظر القبول", "مدير النظام"];

export function serviceClient(): SupabaseClient {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(SUPABASE_URL)) {
    throw new Error("seed: refusing to touch a non-local Supabase");
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function must<R extends { data: unknown; error: unknown }>(
  label: string,
  p: PromiseLike<R>,
): Promise<NonNullable<R["data"]>> {
  const { data, error } = await p;
  if (error) throw new Error(`seed: ${label}: ${JSON.stringify(error)}`);
  // Writes without .select() answer null; nothing reads their result.
  return data as NonNullable<R["data"]>;
}


async function reset(db: SupabaseClient) {
  // Specialty, workplace and licence-slot rows cascade with their doctor.
  for (const table of ["usage_events", "audit_logs", "pending_signups", "doctors"]) {
    await must(`clear ${table}`, db.from(table).delete().not("id", "is", null));
  }
  await must("clear registry", db.from("moh_practitioners").delete().gte("license_number", 0));
  const users = await must("list users", db.auth.admin.listUsers({ perPage: 1000 }));
  for (const u of users.users) await must("delete user", db.auth.admin.deleteUser(u.id));
}

async function seedRegistry(db: SupabaseClient) {
  // 510020 (the signup test's licence) is left out of the mirror, so signup
  // has to fall back to the live registry, here the stub.
  const rows = toRegistryRows(registry.filter((r) => r["מספר רישיון רופא"] !== 510020));
  await must("registry", db.from("moh_practitioners").insert(rows));
}

async function insertDoctor(db: SupabaseClient, d: SeedDoctor, specialtyId: Map<string, string>, i: number) {
  let authUserId: string | null = null;
  const loginEmail = d.account ? ACCOUNTS[d.account] : d.loginEmail;
  if (loginEmail) {
    const created = await must(
      `user ${loginEmail}`,
      db.auth.admin.createUser({ email: loginEmail, password: PASSWORD, email_confirm: true }),
    );
    authUserId = created.user!.id;
  }
  const row = await must(
    `doctor ${d.key}`,
    db
      .from("doctors")
      .insert({
        auth_user_id: authUserId,
        phone_e164: d.phone,
        phone_display: d.phone.replace("+972", "0").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"),
        license_number: d.license,
        license_region: "IL",
        license_verification_status: d.licenseStatus ?? "verified",
        arabic_first_name: d.first,
        arabic_family_name: d.family,
        arabic_first_name_normalized: normalizeArabic(d.first),
        arabic_family_name_normalized: normalizeArabic(d.family),
        arabic_full_name_normalized: normalizeArabic(`${d.first} ${d.family}`),
        hebrew_first_name: d.hebrewFirst,
        hebrew_family_name: d.hebrewFamily,
        email: d.email ?? null,
        bio: d.bio ?? null,
        career_stage: d.stage,
        residency_start_year: d.residencyYear ?? null,
        certificates: d.certificates ?? [],
        seeking_work: d.seekingWork ?? false,
        featured: d.featured ?? null,
        featured_at: d.featured ? new Date().toISOString() : null,
        consent_directory_use: true,
        is_phone_verified: true,
        is_active: true,
        is_visible: d.visible ?? true,
        is_admin_approved: d.approved ?? true,
        is_admin: d.admin ?? false,
        // Newest first in the admin list follows the seed order.
        created_at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
      })
      .select("id")
      .single(),
  );
  const id = (row as { id: string }).id;
  await must(
    `specialties ${d.key}`,
    db.from("doctor_specialties").insert(d.specialties.map((n) => ({ doctor_id: id, specialty_id: specialtyId.get(n) }))),
  );
  if (d.workplaces.length > 0) {
    await must(
      `workplaces ${d.key}`,
      db.from("doctor_workplaces").insert(
        d.workplaces.map((w, j) => ({
          doctor_id: id,
          name: w.name,
          name_normalized: normalizeArabic(w.name),
          workplace_type: w.type,
          address: w.address ?? null,
          hours: w.hours ?? null,
          phone: w.phone ?? null,
          is_primary: j === 0,
          sort_order: j,
        })),
      ),
    );
  }
  return id;
}

/** Wipes the local database and loads DOCTORS. Returns ids by key. */
export async function seed(): Promise<Record<string, string>> {
  const db = serviceClient();
  await reset(db);
  await seedRegistry(db);
  const specialties = await must("specialties", db.from("specialties").select("id, name_ar"));
  const specialtyId = new Map((specialties as { id: string; name_ar: string }[]).map((s) => [s.name_ar, s.id]));
  const ids: Record<string, string> = {};
  for (const [i, d] of DOCTORS.entries()) ids[d.key] = await insertDoctor(db, d, specialtyId, i);
  return ids;
}

let made = 0;

/**
 * A doctor that belongs to one test: unique phone and licence, removed with
 * `remove()`. Tests that change a doctor use one of these rather than a
 * seeded row, so a retry starts from the same state and nothing leaks into
 * the next test.
 */
export async function createDoctor(over: Partial<SeedDoctor> & { first: string; family: string }) {
  const db = serviceClient();
  const { data } = await db.from("specialties").select("id, name_ar");
  const specialtyId = new Map((data ?? []).map((s: { id: string; name_ar: string }) => [s.name_ar, s.id]));
  const n = `${Date.now() % 100000}${made++}`.padStart(6, "0").slice(-6);
  const d: SeedDoctor = {
    key: `test-${n}`,
    hebrewFirst: "בדיקה",
    hebrewFamily: "בדיקה",
    phone: `+97252${n.padStart(7, "9")}`,
    license: `7${n}`,
    stage: "specialist",
    specialties: ["الباطنية"],
    workplaces: [],
    ...over,
  };
  const id = await insertDoctor(db, d, specialtyId, 30);
  return {
    id,
    remove: async () => {
      const { data: row } = await db.from("doctors").select("auth_user_id").eq("id", id).maybeSingle();
      await db.from("doctors").delete().eq("id", id);
      if (row?.auth_user_id) await db.auth.admin.deleteUser(row.auth_user_id);
    },
  };
}
