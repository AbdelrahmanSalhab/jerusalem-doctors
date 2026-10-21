// The registry refresh (app/api/cron/sync-moh) against the stub registry: the
// weekly sweep copies every licence with every certificate, other nights ask
// only for our doctors' licences, and a licence the registry stopped listing
// sends its doctor to admin review.

import { expect, request, test } from "@playwright/test";
import { BASE_URL, CRON_SECRET } from "../env";
import registry from "../registry.json";
import { createDoctor, serviceClient } from "../seed";

test.describe.configure({ mode: "serial" });

async function runSync() {
  const api = await request.newContext({ baseURL: BASE_URL });
  const res = await api.get("/api/cron/sync-moh", { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  await api.dispose();
  return body;
}

test.afterAll(async () => {
  // The signup tests need 510020 missing from the copy, so they reach the
  // live lookup.
  await serviceClient().from("moh_practitioners").delete().eq("license_number", 510020);
});

test("the first run sweeps the whole registry, keeping every certificate", async () => {
  const body = await runSync();
  const licences = [...new Set(registry.map((r) => r["מספר רישיון רופא"]))].sort();
  expect(body).toMatchObject({ ok: true, scope: "full", rows_upserted: licences.length, flagged: 0 });

  const { data: kept } = await serviceClient().from("moh_practitioners").select("license_number, specialties, specialty_name_he, specialist_since");
  expect((kept ?? []).map((r) => r.license_number).sort()).toEqual(licences);
  // 510002 holds two certificates in the registry, one row each.
  expect(kept!.find((r) => r.license_number === 510002)).toEqual({
    license_number: 510002,
    specialties: ["פנימית", "קרדיולוגיה"],
    specialty_name_he: "קרדיולוגיה",
    specialist_since: "2018-06-01",
  });
});

test("later nights ask only for our doctors, and flag a licence the registry dropped, once", async () => {
  const gone = await createDoctor({ first: "ترخيص", family: "مفقود" });
  try {
    const first = await runSync();
    expect(first).toMatchObject({ ok: true, scope: "ours", flagged: 1 });

    const db = serviceClient();
    const { data: doctor } = await db.from("doctors").select("license_verification_status").eq("id", gone.id).single();
    expect(doctor?.license_verification_status).toBe("not_found");
    const { data: audit } = await db.from("audit_logs").select("metadata").eq("action", "license_missing_from_registry").eq("target_doctor_id", gone.id);
    expect(audit).toEqual([{ metadata: expect.objectContaining({ slot: "primary", license_status_before: "verified" }) }]);

    // Already flagged: the next night leaves it alone.
    expect(await runSync()).toMatchObject({ scope: "ours", flagged: 0 });
  } finally {
    await serviceClient().from("audit_logs").delete().eq("target_doctor_id", gone.id);
    await gone.remove();
  }
});
