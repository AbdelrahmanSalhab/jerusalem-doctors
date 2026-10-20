// scripts/add-dev-login.ts
//
// Adds an email and password to an auth user that only has a phone, so the
// people already in the doctors table can sign in at /login/dev without a
// WhatsApp code.
//
// Nothing is linked or created here. An admin who has signed in by phone
// already has an auth.users row, and their doctors row already carries its
// auth_user_id; this only adds a second way to authenticate as that same
// user. The doctors row, its is_admin flag and the audit trail are untouched,
// so whoever signs in is still themselves.
//
// The dashboard cannot do this for a phone-only user, hence the Admin API.
//
// Usage:
//   npm run dev-login:list
//   npm run dev-login:add -- --phone +972501112233 --email qa@example.com
//   npm run dev-login:add -- --phone +972501112233 --email qa@example.com --password '...'
//
// Without --password a strong one is generated and printed once. Put it in a
// password manager; it is not stored anywhere else and cannot be read back.

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (expected in .env.local)");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** 24 characters of base64url: ~143 bits, well past any password policy. */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

interface DoctorRow {
  id: string;
  auth_user_id: string | null;
  phone_e164: string;
  arabic_first_name: string;
  arabic_family_name: string;
  is_admin: boolean;
  is_active: boolean;
}

async function listAdmins(): Promise<void> {
  const { data, error } = await admin
    .from("doctors")
    .select("id, auth_user_id, phone_e164, arabic_first_name, arabic_family_name, is_admin, is_active")
    .eq("is_admin", true)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("could not read doctors:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as DoctorRow[];
  console.log(`${rows.length} admin doctor(s):\n`);
  for (const d of rows) {
    const name = `${d.arabic_first_name} ${d.arabic_family_name}`;
    if (!d.auth_user_id) {
      console.log(`  ${d.phone_e164}  ${name}  — no auth user yet; they must sign in by phone once first`);
      continue;
    }
    const { data: user } = await admin.auth.admin.getUserById(d.auth_user_id);
    const email = user?.user?.email;
    const state = email ? `email: ${email}` : "no email yet";
    console.log(`  ${d.phone_e164}  ${name}  — ${state}${d.is_active ? "" : "  (ACCOUNT CLOSED)"}`);
  }
  console.log("\nAdd one with:  npm run dev-login:add -- --phone <phone> --email <email>");
}

async function addLogin(phone: string, email: string, password: string): Promise<void> {
  const { data, error } = await admin
    .from("doctors")
    .select("id, auth_user_id, phone_e164, arabic_first_name, arabic_family_name, is_admin, is_active")
    .eq("phone_e164", phone)
    .maybeSingle();
  if (error) {
    console.error("could not read doctors:", error.message);
    process.exit(1);
  }
  const doctor = data as DoctorRow | null;

  if (!doctor) {
    console.error(`no doctor with phone ${phone}`);
    process.exit(1);
  }
  if (!doctor.auth_user_id) {
    console.error(
      `${phone} has no auth user yet. They need to sign in by phone once, which creates it; then run this again.`,
    );
    process.exit(1);
  }
  if (!doctor.is_active) {
    console.error(`${phone} is a closed account; /login/dev would refuse it. Reopen it first.`);
    process.exit(1);
  }

  // email_confirm skips the confirmation mail: these are addresses the team
  // already controls, and an unconfirmed email cannot sign in with a password.
  const updated = await admin.auth.admin.updateUserById(doctor.auth_user_id, {
    email,
    password,
    email_confirm: true,
  });
  if (updated.error) {
    console.error("could not update the auth user:", updated.error.message);
    process.exit(1);
  }

  const name = `${doctor.arabic_first_name} ${doctor.arabic_family_name}`;
  console.log(`\n  ${name} (${phone})${doctor.is_admin ? " — admin" : ""}`);
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log("\n  Shown once. Store it in a password manager.");
  console.log(`\n  Then add the address to DEV_LOGIN_EMAILS in Vercel, alongside DEV_LOGIN=1, and redeploy.`);
}

const phone = arg("phone");
const email = arg("email");

if (process.argv.includes("--list")) {
  await listAdmins();
} else if (phone && email) {
  await addLogin(phone, email, arg("password") ?? generatePassword());
} else {
  console.log(
    [
      "Add an email and password to someone who signs in by phone today.",
      "",
      "  npm run dev-login:list",
      "  npm run dev-login:add -- --phone +972501112233 --email qa@example.com",
      "",
      "--password is optional; one is generated and printed once if omitted.",
    ].join("\n"),
  );
  process.exit(1);
}
