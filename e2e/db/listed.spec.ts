// Who is in the directory is the listed_doctors view (#158). Each of the five
// conditions, taken away from an otherwise listed doctor, must take that
// doctor out of everything that serves the directory: the view itself,
// search_directory(), directory_counts(), and the admin panel's own
// explanation (directoryVisibility), which restates the conditions in words.
// The public key must see none of it.

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { directoryVisibility } from "../../lib/admin/doctorState";
import { ANON_KEY, SUPABASE_URL } from "../env";
import { createDoctor, serviceClient } from "../seed";

const CONDITIONS = ["is_active", "is_visible", "is_phone_verified", "is_admin_approved", "consent_directory_use"] as const;

async function inView(id: string): Promise<boolean> {
  const { data, error } = await serviceClient().from("listed_doctors").select("id").eq("id", id);
  expect(error).toBeNull();
  return data!.length > 0;
}

async function inSearch(name: string): Promise<boolean> {
  const { data, error } = await serviceClient().rpc("search_directory", { p_term: name });
  expect(error).toBeNull();
  return (data as { arabic_full_name: string }[]).some((c) => c.arabic_full_name === name);
}

async function listedCount(): Promise<number> {
  const { data, error } = await serviceClient().rpc("directory_counts");
  expect(error).toBeNull();
  return (data as { listed: number }).listed;
}

test("a doctor missing any one condition is in none of the places that serve the directory", async () => {
  const db = serviceClient();
  // No letter the search normalizes (ة أ إ ى), so the term matches as typed.
  const doctor = await createDoctor({ first: "منذر", family: "الاختبار" });
  const name = "منذر الاختبار";
  try {
    // Listed first, so each absence below is caused by the condition.
    expect(await inView(doctor.id)).toBe(true);
    expect(await inSearch(name)).toBe(true);
    const listed = await listedCount();

    for (const condition of CONDITIONS) {
      await db.from("doctors").update({ [condition]: false }).eq("id", doctor.id);
      const { data: flags } = await db.from("doctors").select(CONDITIONS.join(", ")).eq("id", doctor.id).single();

      expect(await inView(doctor.id), `${condition}: the view`).toBe(false);
      expect(await inSearch(name), `${condition}: search`).toBe(false);
      expect(await listedCount(), `${condition}: the count`).toBe(listed - 1);
      // The words the admin reads say the same as the database does.
      expect(directoryVisibility(flags as unknown as Parameters<typeof directoryVisibility>[0]).listed, `${condition}: the admin's explanation`).toBe(false);

      await db.from("doctors").update({ [condition]: true }).eq("id", doctor.id);
    }
    expect(await inView(doctor.id)).toBe(true);
  } finally {
    await doctor.remove();
  }
});

test("the view carries the public columns only", async () => {
  const { data, error } = await serviceClient().from("listed_doctors").select("*").limit(1);
  expect(error).toBeNull();
  const columns = Object.keys(data![0]);
  for (const never of ["license_number", "license_region", "license_verification_status", "auth_user_id", "is_admin", "is_admin_approved", "consent_directory_use", "consent_timestamp", "phone_verified_at"]) {
    expect(columns, never).not.toContain(never);
  }
  expect(columns).toEqual(expect.arrayContaining(["id", "arabic_full_name", "phone_e164", "career_stage"]));
});

test("the public key sees nothing through the view", async () => {
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.from("listed_doctors").select("id");
  // Either refused outright or an empty answer, never a doctor.
  expect(data ?? []).toEqual([]);
  expect(error === null || /permission denied|not exist|Could not find/i.test(error.message)).toBe(true);
});
