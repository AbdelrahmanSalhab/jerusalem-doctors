import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/test/fakeSupabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readMirrorFreshness, readMirrorRows } from "./mirror";

const service = db.client as unknown as SupabaseClient;

const ROW = {
  license_number: 9417,
  hebrew_first_name: "דניאל",
  hebrew_family_name: "דריפוס",
  hebrew_first_norm: "דניאל",
  hebrew_family_norm: "דריפוס",
  specialty_name_he: "פסיכיאטריה",
  specialties: ["פסיכיאטריה"],
  license_issued_on: "2011-05-03",
  specialist_since: "2017-02-01",
  synced_at: "2026-10-19T03:00:00.000Z",
};

beforeEach(() => db.reset());

describe("readMirrorRows", () => {
  it("keys rows by serial as a string, the way doctors.license_number stores it", async () => {
    db.queue("moh_practitioners", { data: [ROW] });
    const rows = await readMirrorRows(service, ["9417"]);
    expect(rows.get("9417")?.hebrewFirstName).toBe("דניאל");
    expect(rows.get("9417")?.specialtyHe).toBe("פסיכיאטריה");
    expect(db.argsOf("moh_practitioners", "in")).toEqual([["license_number", [9417]]]);
  });

  it("asks once for a de-duplicated set of candidate serials", async () => {
    db.queue("moh_practitioners", { data: [] });
    await readMirrorRows(service, ["1189371", "189371", "1189371"]);
    expect(db.argsOf("moh_practitioners", "in")).toEqual([["license_number", [1189371, 189371]]]);
  });

  it("does not query at all for a licence with no registry to search", async () => {
    // A Palestinian licence number is not an Israeli registry serial.
    const rows = await readMirrorRows(service, ["PS-44/2", "", "0"]);
    expect(rows.size).toBe(0);
    expect(db.argsOf("moh_practitioners", "select")).toEqual([]);
  });

  it("reads a whitespace-only specialty as no specialty", async () => {
    db.queue("moh_practitioners", { data: [{ ...ROW, specialty_name_he: "   " }] });
    const rows = await readMirrorRows(service, ["9417"]);
    expect(rows.get("9417")?.specialtyHe).toBeNull();
  });

  it("throws rather than reporting a doctor as absent when the read fails", async () => {
    db.queue("moh_practitioners", { error: { message: "boom" } });
    await expect(readMirrorRows(service, ["9417"])).rejects.toThrow(/moh_practitioners read failed/);
  });
});

describe("readMirrorFreshness", () => {
  it("returns when the registry copy was last refreshed", async () => {
    db.queue("audit_logs", { data: { created_at: "2026-10-19T03:00:00.000Z" } });
    expect(await readMirrorFreshness(service)).toBe("2026-10-19T03:00:00.000Z");
    expect(db.argsOf("audit_logs", "eq")).toEqual([["action", "moh_sync_completed"]]);
  });

  it("is null, not an error, when no sync has been recorded", async () => {
    db.queue("audit_logs", { data: null });
    expect(await readMirrorFreshness(service)).toBeNull();
  });

  it("stays null on a read error, so a page render never fails over it", async () => {
    db.queue("audit_logs", { error: { code: "42P01", message: "no table" } });
    expect(await readMirrorFreshness(service)).toBeNull();
  });
});
