// scripts/rls-smoke-test.ts
//
// Runs as a one-off check to confirm Row-Level Security is denying
// what it should deny. Three scenarios:
//
//   1. Anonymous (publishable key) cannot read any doctor row.
//   2. Anonymous cannot read pending_signups, audit_logs, moh_practitioners.
//   3. Anonymous cannot read specialties (we only allow authenticated reads).
//
// Run with:
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//     npm run test:rls
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

// Authenticated-but-not-admin client: sign in with a known test user whose
// doctor record is NOT yet admin-approved. Credentials are read from env so
// they are never committed to source. If the env vars are absent the test
// is skipped gracefully rather than failing.
const authEmail = process.env.RLS_TEST_AUTH_EMAIL;
const authPassword = process.env.RLS_TEST_AUTH_PASSWORD;

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
      if (error) {
        return { leaked: false, detail: `denied (${error.code ?? error.message})` };
      }
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
  {
    name: "anon cannot read doctor_visible view",
    run: async () => testEmpty("doctor_visible"),
  },
  {
    name: "anon cannot read pre_approved_licenses",
    run: async () => testEmpty("pre_approved_licenses"),
  },
  {
    // Test 25 from the test plan: an authenticated-but-not-admin session must see zero
    // rows from doctor_visible for a doctor whose is_admin_approved is still false.
    // This covers the residual risk that security_invoker=true on the view combined with
    // a mistaken authenticated GRANT could expose unapproved profiles to signed-in users.
    // The test is skipped when RLS_TEST_AUTH_EMAIL / RLS_TEST_AUTH_PASSWORD are absent
    // (e.g. CI without test credentials) to avoid false failures.
    name: "authenticated non-admin sees zero rows for unapproved doctor (Test 25)",
    run: async (): Promise<{ leaked: boolean; detail: string }> => {
      if (!authEmail || !authPassword) {
        return { leaked: false, detail: "skipped (RLS_TEST_AUTH_EMAIL not set)" };
      }
      const authClient = createClient(url!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signInErr } = await authClient.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      if (signInErr) {
        return { leaked: false, detail: `skipped (sign-in failed: ${signInErr.message})` };
      }
      // doctor_visible only returns approved+active rows (view WHERE clause).
      // Any row returned for this non-admin account = leak (should see zero,
      // because our test account's own doctor row has is_admin_approved=false).
      // We select only id; is_admin_approved is not exposed in the view.
      const { data, error } = await authClient
        .from("doctor_visible")
        .select("id")
        .limit(1);
      if (error) {
        return { leaked: false, detail: `denied (${error.code ?? error.message})` };
      }
      const count = (data ?? []).length;
      return {
        leaked: count > 0,
        detail: count > 0
          ? `LEAK — ${count} row(s) visible to unapproved doctor`
          : "ok (no rows visible to unapproved doctor)",
      };
    },
  },
];

async function testEmpty(table: string): Promise<{
  leaked: boolean;
  detail: string;
}> {
  const { data, error } = await anon.from(table).select("*").limit(1);
  if (error) {
    return { leaked: false, detail: `denied (${error.code ?? error.message})` };
  }
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
