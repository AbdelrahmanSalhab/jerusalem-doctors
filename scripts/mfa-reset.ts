// scripts/mfa-reset.ts
//
// Break-glass for the admin second factor (#164, docs/runbook.md): removes the
// authenticator of an admin who lost their phone when no super admin can do it
// from the panel (both locked out, or the panel is down). Run it where
// SUPABASE_SERVICE_ROLE_KEY is available, i.e. by someone who already holds
// the project's keys.
//
// It removes every factor of the account and opens the one-hour window in
// which that admin may enrol a new one from «ملفي» (the same as the panel's
// reset, lib/auth/mfaReset.ts). It does not write the audit log: say so in
// the team channel.
//
// Usage:
//   npm run mfa:reset -- --email admin@example.com

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[process.argv.indexOf("--email") + 1]?.toLowerCase();

if (!url || !serviceKey) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (expected in .env.local)");
  process.exit(1);
}
if (!email || !email.includes("@") || process.argv.indexOf("--email") === -1) {
  console.error("usage: npm run mfa:reset -- --email admin@example.com");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;

// listUsers pages; the project has a handful of accounts, so a page of 1000 is all of them.
const { data, error } = await admin.listUsers({ perPage: 1000 });
if (error) throw error;
const user = data.users.find((u) => u.email?.toLowerCase() === email);
if (!user) {
  console.error(`no account signs in with ${email}`);
  process.exit(1);
}

const { data: listed, error: listError } = await admin.mfa.listFactors({ userId: user.id });
if (listError) throw listError;
for (const f of listed.factors) {
  const { error: delError } = await admin.mfa.deleteFactor({ id: f.id, userId: user.id });
  if (delError) throw delError;
}
const { error: updError } = await admin.updateUserById(user.id, {
  app_metadata: { mfa_enrol_until: Date.now() + 60 * 60 * 1000 },
});
if (updError) throw updError;

console.log(`removed ${listed.factors.length} factor(s) of ${email}; they have one hour to enrol a new one from «ملفي».`);
