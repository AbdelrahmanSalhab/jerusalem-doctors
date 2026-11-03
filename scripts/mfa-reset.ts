// scripts/mfa-reset.ts
//
// Break-glass for the admin second factor (#164, docs/runbook.md): removes the
// authenticator of an admin who lost their phone when no super admin can do it
// from the panel (both locked out, or the panel is down). Run it where
// SUPABASE_SERVICE_ROLE_KEY is available, i.e. by someone who already holds
// the project's keys.
//
// It removes every factor of the account and opens the 15 minute window in
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

const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = client.auth.admin;

// listUsers pages: walk them all rather than assume the project is small.
let user: { id: string } | undefined;
for (let page = 1; !user; page++) {
  const { data, error } = await admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  user = data.users.find((u) => u.email?.toLowerCase() === email);
  if (data.users.length < 1000) break;
}
if (!user) {
  console.error(`no account signs in with ${email}`);
  process.exit(1);
}
const { data: doctor } = await client.from("doctors").select("id, is_admin").eq("auth_user_id", user.id).maybeSingle();
if (!doctor?.is_admin) {
  console.error(`${email} is not an admin account; nothing changed`);
  process.exit(1);
}

// The window first, so a failure halfway cannot leave the admin locked out.
const { error: updError } = await admin.updateUserById(user.id, {
  app_metadata: { mfa_enrol_until: Date.now() + 15 * 60 * 1000 },
});
if (updError) throw updError;
const { data: listed, error: listError } = await admin.mfa.listFactors({ userId: user.id });
if (listError) throw listError;
for (const f of listed.factors) {
  const { error: delError } = await admin.mfa.deleteFactor({ id: f.id, userId: user.id });
  if (delError) throw delError;
}
await client.from("audit_logs").insert({
  action: "admin_mfa_reset",
  target_doctor_id: doctor.id,
  metadata: { factors: listed.factors.length, via: "script" },
});

console.log(`removed ${listed.factors.length} factor(s) of ${email}; they have 15 minutes to enrol a new one from «ملفي».`);
