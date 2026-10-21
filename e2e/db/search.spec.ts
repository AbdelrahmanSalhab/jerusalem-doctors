// search_directory() on the real database: what a search matches, who it
// never shows, and the order. The route around it is unit-tested
// (app/api/search/route.test.ts).

import { expect, test } from "@playwright/test";
import { createDoctor, serviceClient } from "../seed";

interface Card {
  arabic_full_name: string;
  doctor_specialties: { specialty: { name_ar: string } }[];
  doctor_workplaces: { name: string }[];
}

async function search(args: { p_term?: string; p_specialty_id?: string; p_institution_ids?: string[]; p_limit?: number }) {
  const { data, error } = await serviceClient().rpc("search_directory", args);
  expect(error).toBeNull();
  return data as Card[];
}
const names = (cards: Card[]) => cards.map((c) => c.arabic_full_name);

async function idOf(table: "specialties" | "institutions", name: string): Promise<string> {
  const { data } = await serviceClient().from(table).select("id").eq("name_ar", name).single();
  return data!.id;
}

test("lists only listed doctors, in code-unit order", async () => {
  const listed = names(await search({}));
  // Not the hidden, the waiting, the closed account, or the staff admin.
  expect(listed).toEqual(["سامر ناصر", "ليلى الخطيب", "مريم عودة", "يوسف حداد"].sort());
  for (const never of ["خفي المخفي", "منتظر القبول", "مغلق الحساب", "مدير النظام"]) expect(listed).not.toContain(never);
});

test("finds a doctor by part of their name", async () => {
  expect(names(await search({ p_term: "سامر" }))).toEqual(["سامر ناصر"]);
  expect(names(await search({ p_term: "خطيب" }))).toEqual(["ليلى الخطيب"]);
});

test("a specialty name brings in its subspecialties", async () => {
  // سامر is stored under القلب only, a subspecialty of الباطنية.
  expect(names(await search({ p_term: "الباطنية" }))).toEqual(["سامر ناصر"]);
  expect(names(await search({ p_specialty_id: await idOf("specialties", "الباطنية") }))).toEqual(["سامر ناصر"]);
  expect(names(await search({ p_specialty_id: await idOf("specialties", "الأطفال") }))).toEqual(["ليلى الخطيب", "مريم عودة"]);
});

test("finds by workplace name, and by an institution the app matched", async () => {
  expect(names(await search({ p_term: "بيت حنينا" }))).toEqual(["سامر ناصر"]);
  // The app resolves "اوغستا" to المطّلع by its spellings and passes the id;
  // this doctor wrote a name the term does not contain, linked to it.
  const mattla = await idOf("institutions", "المطّلع (أوغستا فكتوريا)");
  const linked = await createDoctor({ first: "مرتبط", family: "بمؤسسة", workplaces: [{ name: "Augusta", type: "hospital" }] });
  try {
    await serviceClient().from("doctor_workplaces").update({ institution_id: mattla }).eq("doctor_id", linked.id);
    expect(names(await search({ p_term: "اوغستا", p_institution_ids: [mattla] }))).toContain("مرتبط بمؤسسة");
    expect(names(await search({ p_term: "اوغستا" }))).not.toContain("مرتبط بمؤسسة");
  } finally {
    await linked.remove();
  }
});

test("a filter and a term both apply", async () => {
  const peds = await idOf("specialties", "الأطفال");
  expect(names(await search({ p_term: "مريم", p_specialty_id: peds }))).toEqual(["مريم عودة"]);
  expect(names(await search({ p_term: "سامر", p_specialty_id: peds }))).toEqual([]);
});

test("stops at the limit and carries the card's specialties and workplaces", async () => {
  expect(await search({ p_limit: 2 })).toHaveLength(2);
  const [samer] = await search({ p_term: "سامر" });
  expect(samer.doctor_specialties.map((s) => s.specialty.name_ar)).toEqual(["القلب"]);
  expect(samer.doctor_workplaces.map((w) => w.name).sort()).toEqual(["المقاصد", "عيادة القلب في بيت حنينا"].sort());
});
