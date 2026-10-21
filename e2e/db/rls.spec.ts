// Row-level security, checked against the real database built from the repo's
// migrations. Supabase grants anon and authenticated broad privileges on every
// public table, so RLS is the only thing between the public anon key and the
// data. Tables and functions are read from PostgREST's own schema listing, so
// a new table is covered the day it is added.

import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNTS, ANON_KEY, PASSWORD, SERVICE_ROLE_KEY, SUPABASE_URL } from "../env";
import { seededIds } from "../helpers";
import { serviceClient } from "../seed";

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, ANON_KEY, opts);
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return c;
}

/** Every table and function PostgREST exposes. */
async function exposed(): Promise<{ tables: string[]; rpcs: string[]; firstColumn: Record<string, string> }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const spec = (await res.json()) as {
    paths: Record<string, unknown>;
    definitions: Record<string, { properties: Record<string, unknown> }>;
  };
  const paths = Object.keys(spec.paths);
  const tables = paths.filter((p) => p !== "/" && !p.startsWith("/rpc/")).map((p) => p.slice(1));
  return {
    tables,
    rpcs: paths.filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5)),
    // A filter every row matches, so a delete would reach all of them.
    firstColumn: Object.fromEntries(tables.map((t) => [t, Object.keys(spec.definitions[t].properties)[0]])),
  };
}

/** Readable rows per role. Anything not listed must read as empty. */
const READABLE: Record<string, Record<string, "own" | "all" | "visible">> = {
  doctor: { doctors: "own", specialties: "all", doctor_specialties: "visible", doctor_workplaces: "visible" },
};

const anon = createClient(SUPABASE_URL, ANON_KEY, opts);

test.describe("row-level security", () => {
  let tables: string[] = [];
  let rpcs: string[] = [];
  let firstColumn: Record<string, string> = {};
  let doctor: SupabaseClient;

  test.beforeAll(async () => {
    ({ tables, rpcs, firstColumn } = await exposed());
    doctor = await signedIn(ACCOUNTS.doctor);
  });

  test("the listing found the tables the app depends on", () => {
    expect(tables).toEqual(expect.arrayContaining(["doctors", "audit_logs", "pending_signups", "moh_practitioners", "doctor_license_slots"]));
  });

  test("every table has row-level security switched on", async () => {
    // Ask with the anon key for every row: with RLS off the default grants
    // would return the seeded data.
    for (const t of tables) {
      const { data } = await anon.from(t).select("*").limit(1);
      expect(data ?? [], `anon read ${t}`).toEqual([]);
    }
  });

  test("anon cannot insert, update or delete anything", async () => {
    const db = serviceClient();
    for (const t of tables) {
      const before = await db.from(t).select("*", { count: "exact", head: true });
      const ins = await anon.from(t).insert({}).select();
      expect(ins.data ?? [], `anon insert ${t}`).toEqual([]);
      expect(ins.error, `anon insert ${t}`).not.toBeNull();
      const del = await anon.from(t).delete().not(firstColumn[t], "is", null).select();
      expect(del.data ?? [], `anon delete ${t}`).toEqual([]);
      const after = await db.from(t).select("*", { count: "exact", head: true });
      expect(after.count, `rows in ${t}`).toBe(before.count);
    }
  });

  test("a signed-in doctor reads only what the directory already shows", async () => {
    const ids = seededIds();
    for (const t of tables) {
      const { data, error } = await doctor.from(t).select("*");
      // A missing grant (42501) is a denial; any other error is a bug:
      // is_admin() once recursed through RLS to "stack depth limit
      // exceeded" (0020), which an "empty or error" check let through.
      if (error) expect(error.code, `doctor read ${t}: ${error.message}`).toBe("42501");
      const rows = (data ?? []) as Record<string, unknown>[];
      const rule = READABLE.doctor[t];
      if (!rule) {
        expect(rows, `doctor read ${t}`).toEqual([]);
      } else if (rule === "own") {
        expect(rows.map((r) => r.id), `doctor read ${t}`).toEqual([ids.samer]);
      } else if (rule === "visible") {
        const hiddenOrPending = [ids.hidden, ids.pending, ids.admin];
        expect(rows.length, `doctor read ${t}`).toBeGreaterThan(0);
        expect(rows.some((r) => hiddenOrPending.includes(r.doctor_id as string)), `doctor read ${t}`).toBe(false);
      }
    }
  });

  test("an admin's own session reads every doctor and the activity log", async () => {
    const admin = await signedIn(ACCOUNTS.admin);
    const doctors = await admin.from("doctors").select("id");
    expect(doctors.error).toBeNull();
    const all = await serviceClient().from("doctors").select("id", { count: "exact", head: true });
    expect(doctors.data?.length).toBe(all.count);
    const audit = await admin.from("audit_logs").select("id").limit(1);
    expect(audit.error).toBeNull();
  });

  test("a signed-in doctor cannot change anyone, including themselves", async () => {
    const ids = seededIds();
    const db = serviceClient();
    // The classic escalation: making yourself an admin straight through PostgREST.
    const self = await doctor.from("doctors").update({ is_admin: true }).eq("id", ids.samer).select();
    expect(self.data ?? []).toEqual([]);
    const other = await doctor.from("doctors").update({ is_visible: false }).eq("id", ids.laila).select();
    expect(other.data ?? []).toEqual([]);
    const rows = await db.from("doctors").select("id, is_admin, is_visible").in("id", [ids.samer, ids.laila]);
    expect(rows.data).toEqual(
      expect.arrayContaining([
        { id: ids.samer, is_admin: false, is_visible: true },
        { id: ids.laila, is_admin: false, is_visible: true },
      ]),
    );
    const spec = await doctor.from("specialties").insert({ name_ar: "تخصص مزيف", name_ar_normalized: "تخصص مزيف" }).select();
    expect(spec.error).not.toBeNull();
    const slot = await doctor.from("doctor_license_slots").update({ license_number: "999999" }).eq("doctor_id", ids.samer).select();
    expect(slot.data ?? []).toEqual([]);
  });

  test("helpers the policies use are not callable through the API", () => {
    // private.is_admin() (migration 20261021103844): the policies call it,
    // nobody else should.
    expect(rpcs).not.toContain("is_admin");
  });

  test("only the server can call the privileged functions", async () => {
    const ids = seededIds();
    // Real arguments, so the call reaches the permission check: a doctor
    // saving someone else's profile would be the escalation.
    const ARGS: Record<string, Record<string, unknown>> = {
      admin_stats: {},
      admin_audit_events: {},
      search_directory: {},
      directory_counts: {},
      record_daily_metrics: { p_day: "2001-01-01" },
      save_doctor_profile: { p_doctor_id: ids.laila, p_updates: { bio: "x" }, p_specialty_ids: null, p_workplaces: null },
    };
    for (const fn of Object.keys(ARGS)) {
      expect(rpcs).toContain(fn);
      for (const [who, client] of [["anon", anon], ["doctor", doctor]] as const) {
        const { error } = await client.rpc(fn, ARGS[fn]);
        expect(error?.code, `${who} calls ${fn}`).toBe("42501");
      }
    }
  });
});
