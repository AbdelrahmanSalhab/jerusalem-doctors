// scripts/rls-smoke-test.ts
//
// Runs as a one-off check to confirm Row-Level Security is denying
// what it should deny. Three scenarios:
//
//   1. Anonymous (publishable key) cannot read any doctor row.
//   2. Anonymous cannot read pending_signups, audit_logs, moh_practitioners.
//   3. Anonymous cannot read specialties (we only allow authenticated reads).
//   4. Neither anon nor a signed-in doctor holds UPDATE on doctors,
//      doctor_specialties or doctor_workplaces (0011). Every write goes
//      through the service role; a grant here would let a doctor PATCH their
//      own is_admin straight through PostgREST.
//
// Run with:
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//     npm run test:rls
//
// Set RLS_TEST_DOCTOR_JWT to a signed-in doctor's access token to also run
// the authenticated check. The update targets a row id that cannot exist, so
// a leak is detected without changing any data.
//
// Exits 1 on any leak; 0 if everything is locked down.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    "RLS test: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
  process.exit(1);
}

const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const NO_SUCH_ROW = "00000000-0000-0000-0000-000000000000";

/** One harmless UPDATE per table, filtered on a key no row can have. */
const WRITE_PROBES = [
  { table: "doctors", patch: { is_admin: false }, key: "id" },
  { table: "doctor_specialties", patch: { specialty_id: NO_SUCH_ROW }, key: "doctor_id" },
  { table: "doctor_workplaces", patch: { name: "rls-probe" }, key: "id" },
] as const;

interface Check {
  name: string;
  run: () => Promise<{ leaked: boolean; detail: string }>;
}

const checks: Check[] = [
  {
    name: "anon cannot read doctors",
    run: async () => {
      const { data, error } = await anon
        .from("doctors")
        .select("id")
        .limit(1);
      if (error) return deniedOrUnreachable(error);
      const count = data?.length ?? 0;
      return {
        leaked: count > 0,
        detail: count > 0 ? `LEAK — read ${count} row(s)` : "ok (empty)",
      };
    },
  },
  {
    name: "anon cannot read pending_signups",
    run: async () => testEmpty("pending_signups"),
  },
  {
    name: "anon cannot read audit_logs",
    run: async () => testEmpty("audit_logs"),
  },
  {
    name: "anon cannot read moh_practitioners",
    run: async () => testEmpty("moh_practitioners"),
  },
  {
    name: "anon cannot read specialties (auth-only)",
    run: async () => testEmpty("specialties"),
  },
  {
    name: "anon cannot read doctor_specialties",
    run: async () => testEmpty("doctor_specialties"),
  },
  {
    name: "anon cannot read doctor_workplaces",
    run: async () => testEmpty("doctor_workplaces"),
  },
  ...writeChecks("anon", anon),
];

const doctorJwt = process.env.RLS_TEST_DOCTOR_JWT;
if (doctorJwt) {
  const asDoctor = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${doctorJwt}` } },
  });
  checks.push(...writeChecks("doctor", asDoctor));
}

function writeChecks(role: string, client: typeof anon): Check[] {
  return WRITE_PROBES.map((p) => ({
    name: `${role} cannot update ${p.table}`,
    run: async () => testNoUpdate(client, p),
  }));
}

/** Postgres checks the table privilege before matching rows, so without the
 *  grant this fails with 42501 even though no row matches. Success (with
 *  zero rows touched) means the role still holds UPDATE. */
async function testNoUpdate(
  client: typeof anon,
  probe: (typeof WRITE_PROBES)[number],
): Promise<{ leaked: boolean; detail: string }> {
  const { error } = await client
    .from(probe.table)
    .update(probe.patch)
    .eq(probe.key, NO_SUCH_ROW);
  if (error) return deniedOrUnreachable(error);
  return { leaked: true, detail: "LEAK: UPDATE privilege granted" };
}

/** Postgres/PostgREST denials carry a code; a transport failure (bad URL,
 *  network down) does not, and must fail the run rather than read as a
 *  denial. */
function deniedOrUnreachable(error: { code?: string; message: string }): {
  leaked: boolean;
  detail: string;
} {
  return error.code
    ? { leaked: false, detail: `denied (${error.code})` }
    : { leaked: true, detail: `UNREACHABLE: ${error.message}` };
}

async function testEmpty(table: string): Promise<{
  leaked: boolean;
  detail: string;
}> {
  const { data, error } = await anon.from(table).select("*").limit(1);
  if (error) return deniedOrUnreachable(error);
  const count = data?.length ?? 0;
  return {
    leaked: count > 0,
    detail: count > 0 ? `LEAK — read ${count} row(s)` : "ok (empty)",
  };
}

(async () => {
  let leaked = 0;
  for (const c of checks) {
    const r = await c.run();
    const status = r.leaked ? "❌ LEAK" : "✅";
    console.log(`${status}  ${c.name.padEnd(46)} ${r.detail}`);
    if (r.leaked) leaked++;
  }
  console.log("");
  if (leaked > 0) {
    console.error(`RLS test FAILED: ${leaked} leak(s) detected.`);
    process.exit(1);
  }
  console.log("RLS test passed — no anon leaks detected.");
})();
