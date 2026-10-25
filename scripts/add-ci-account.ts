// scripts/add-ci-account.ts
//
// Creates the account the production smoke check signs in as
// (POST /api/login/ci), once. It has no password and no phone, and its email
// is on the reserved .invalid domain, so nothing but a GitHub token from the
// smoke workflow signs it in. Hidden from the directory, like the other staff
// accounts, and an admin, because the smoke check opens the admin pages.
//
// Usage:
//   npm run ci-login:add
// Then set CI_LOGIN_EMAIL=ci@jerusalem-doctors.invalid on Vercel (Production)
// and redeploy. Running it again changes nothing.

import { createClient } from "@supabase/supabase-js";

const EMAIL = "ci@jerusalem-doctors.invalid";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (expected in .env.local)");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found || data.users.length < 1000) return found ?? null;
  }
}

async function main() {
  const user =
    (await findUser(EMAIL)) ??
    // No password: this account cannot sign in at /login/dev or anywhere else.
    (await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true })).data.user;
  if (!user) throw new Error("could not create the auth user");

  const { data: row, error: readError } = await admin.from("doctors").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (readError) throw readError;
  if (row) {
    console.log(`already there: doctors row ${row.id}`);
  } else {
    const { data, error } = await admin
      .from("doctors")
      .insert({
        auth_user_id: user.id,
        // Placeholders: the row is staff, never listed, never contacted.
        phone_e164: "+000000000000",
        arabic_first_name: "اختبار",
        arabic_family_name: "آلي",
        arabic_first_name_normalized: "اختبار",
        arabic_family_name_normalized: "الي",
        arabic_full_name_normalized: "اختبار الي",
        // CI_LICENSE in lib/admin/doctorState.ts: the admin list knows it by this.
        license_number: "CI",
        license_region: "IL",
        consent_directory_use: true,
        is_phone_verified: false,
        is_active: true,
        is_admin: true,
        is_admin_approved: true,
        is_visible: false,
      })
      .select("id")
      .single();
    if (error) throw error;
    console.log(`created: doctors row ${data.id}`);
  }
  console.log(`\nNext: on Vercel (Production) set CI_LOGIN_EMAIL=${EMAIL}, then redeploy.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
