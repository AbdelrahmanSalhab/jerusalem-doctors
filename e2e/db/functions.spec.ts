// The two server-side functions, run on the real database: the admin numbers
// must agree with what the directory lists, and a profile save must land
// whole or not at all (0014).

import { expect, test } from "@playwright/test";
import { seededIds } from "../helpers";
import { DOCTORS, LISTED, serviceClient } from "../seed";

test.describe("admin_stats()", () => {
  test("counts doctors, not the hidden admin accounts", async () => {
    const { data, error } = await serviceClient().rpc("admin_stats");
    expect(error).toBeNull();
    const d = (data as { doctors: Record<string, number> }).doctors;
    const doctors = DOCTORS.filter((x) => !x.admin);
    expect(d.total).toBe(doctors.length);
    expect(d.listed).toBe(LISTED.length);
    expect(d.pending).toBe(doctors.filter((x) => x.approved === false).length);
    expect(d.suspended).toBe(1);
    expect(d.seeking_work).toBe(doctors.filter((x) => x.seekingWork).length);
  });
});

test.describe("directory_counts()", () => {
  test("counts listed doctors, rolling subspecialties into their parent", async () => {
    const db = serviceClient();
    const { data, error } = await db.rpc("directory_counts");
    expect(error).toBeNull();
    const counts = data as { listed: number; by_domain: Record<string, number> };
    expect(counts.listed).toBe(LISTED.length);
    const id = async (name: string) => (await db.from("specialties").select("id").eq("name_ar", name).single()).data!.id;
    // سامر is stored under القلب, which counts under الباطنية.
    expect(counts.by_domain[await id("الباطنية")]).toBe(1);
    expect(counts.by_domain[await id("القلب")]).toBeUndefined();
    expect(counts.by_domain[await id("الأطفال")]).toBe(2);
  });
});

test.describe("save_doctor_profile()", () => {
  // The closed account: nothing else in the run reads it.
  const read = async (id: string) => {
    const db = serviceClient();
    const [doc, specs, wps] = await Promise.all([
      db.from("doctors").select("bio").eq("id", id).single(),
      db.from("doctor_specialties").select("specialty_id").eq("doctor_id", id),
      db.from("doctor_workplaces").select("name").eq("doctor_id", id),
    ]);
    return { bio: doc.data?.bio, specialties: specs.data?.length, workplaces: (wps.data ?? []).map((w) => w.name) };
  };

  test("saves the row, specialties and workplaces together", async () => {
    const id = seededIds().closed;
    const db = serviceClient();
    const { data: spec } = await db.from("specialties").select("id").eq("name_ar", "العيون").single();
    const { error } = await db.rpc("save_doctor_profile", {
      p_doctor_id: id,
      p_updates: { bio: "نبذة جديدة" },
      p_specialty_ids: [spec!.id],
      p_workplaces: [{ name: "مستشفى العيون سانت جون", name_normalized: "مستشفي العيون سانت جون", workplace_type: "hospital", is_primary: true, sort_order: 0 }],
    });
    expect(error).toBeNull();
    expect(await read(id)).toEqual({ bio: "نبذة جديدة", specialties: 1, workplaces: ["مستشفى العيون سانت جون"] });
  });

  test("a failing part rolls the whole save back", async () => {
    const id = seededIds().closed;
    const before = await read(id);
    const { error } = await serviceClient().rpc("save_doctor_profile", {
      p_doctor_id: id,
      p_updates: { bio: "يجب ألا تُحفظ" },
      // No such specialty: the foreign key fails after the row update ran.
      p_specialty_ids: ["00000000-0000-4000-8000-00000000dead"],
      p_workplaces: [],
    });
    expect(error).not.toBeNull();
    expect(await read(id)).toEqual(before);
  });
});
