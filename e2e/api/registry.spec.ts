// The nightly registry refresh (app/api/cron/sync-moh) against the stub
// registry: it asks only for our doctors' licences and keeps only those,
// each with every specialty certificate.

import { expect, request, test } from "@playwright/test";
import { BASE_URL, CRON_SECRET } from "../env";
import registry from "../registry.json";
import { serviceClient } from "../seed";

test("the nightly refresh keeps only our doctors' licences, with every certificate", async () => {
  const api = await request.newContext({ baseURL: BASE_URL });
  const res = await api.get("/api/cron/sync-moh", { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  await api.dispose();

  const db = serviceClient();
  const { data: doctors } = await db.from("doctors").select("license_number").eq("license_region", "IL");
  const inRegistry = new Set(registry.map((r) => r["מספר רישיון רופא"]));
  const ours = [...new Set((doctors ?? []).map((d) => Number(d.license_number)))];
  const expected = ours.filter((n) => inRegistry.has(n)).sort();

  const { data: kept } = await db.from("moh_practitioners").select("license_number, specialties, specialty_name_he, specialist_since");
  expect((kept ?? []).map((r) => r.license_number).sort()).toEqual(expected);
  expect(body).toMatchObject({ ok: true, rows_upserted: expected.length, missing: ours.length - expected.length });

  // 510002 holds two certificates in the registry, one row each.
  expect(kept!.find((r) => r.license_number === 510002)).toEqual({
    license_number: 510002,
    specialties: ["פנימית", "קרדיולוגיה"],
    specialty_name_he: "קרדיולוגיה",
    specialist_since: "2018-06-01",
  });
});
