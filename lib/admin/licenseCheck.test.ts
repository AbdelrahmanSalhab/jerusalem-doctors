// Re-checking a licence: the verdict-to-column rule, what a soft match may
// adopt, and finding another doctor who holds the number.

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  adoptableName,
  checkLicense,
  findDuplicate,
  slotColumns,
  storedSlot,
  toColumnStatus,
  type AdminDoctorLicenseRow,
  type CheckOutcome,
} from "./licenseCheck";

/** Every table answers `data`; used for the mirror freshness and the duplicate read. */
function answering(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data, error: null });
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("toColumnStatus", () => {
  it("keeps the stored verdicts, and stores a mismatch only once a human accepted it", () => {
    expect(toColumnStatus("verified")).toBe("verified");
    expect(toColumnStatus("soft_match")).toBe("soft_match");
    expect(toColumnStatus("not_found")).toBe("not_found");
    expect(toColumnStatus("name_mismatch")).toBeNull();
    expect(toColumnStatus("name_mismatch", true)).toBe("name_mismatch_overridden");
  });
});

describe("adoptableName", () => {
  const outcome = (status: string, registry: CheckOutcome["registry"]) => ({ status, registry }) as CheckOutcome;
  it("offers the registry's spelling only for a soft match that has both names", () => {
    expect(adoptableName(outcome("soft_match", { firstName: "דניאל", familyName: "דריפוס", specialtyHe: null }))).toEqual({ first: "דניאל", family: "דריפוס" });
    expect(adoptableName(outcome("soft_match", { firstName: "דניאל", familyName: null, specialtyHe: null }))).toBeNull();
    expect(adoptableName(outcome("soft_match", null))).toBeNull();
    expect(adoptableName(outcome("name_mismatch", { firstName: "א", familyName: "ב", specialtyHe: null }))).toBeNull();
  });
});

describe("slot columns", () => {
  it("names the columns of each slot and reads what one holds", () => {
    expect(slotColumns("primary").number).toBe("license_number");
    expect(slotColumns("secondary").status).toBe("secondary_license_verification_status");
    const row = { license_number: "1", license_region: "IL", license_verification_status: "verified", secondary_license_number: "2", secondary_license_region: "PS", secondary_license_verification_status: null } as AdminDoctorLicenseRow;
    expect(storedSlot(row, "primary")).toEqual({ number: "1", region: "IL", status: "verified" });
    expect(storedSlot(row, "secondary")).toEqual({ number: "2", region: "PS", status: null });
  });
});

describe("checkLicense", () => {
  it("does not look a Palestinian licence up, and says it cannot be checked", async () => {
    const out = await checkLicense(answering(null), { region: "PS", licenseNumber: "12345" } as never);
    expect(out).toMatchObject({ checkable: false, source: "none", checkedNumber: "12345" });
  });

  it("refuses a number it cannot read as a licence", async () => {
    await expect(checkLicense(answering(null), { region: "IL", licenseNumber: "abc" } as never)).rejects.toThrow("unreadable licence number");
  });
});

describe("findDuplicate", () => {
  const holder = (doctor: unknown) => answering({ doctor_id: "d2", doctor });
  it("is null when nobody else holds the number", async () => {
    expect(await findDuplicate(answering(null), "d1", "IL", "5")).toBeNull();
  });

  it("names the other holder, however the embed arrives", async () => {
    const person = { arabic_first_name: "سارة", arabic_family_name: "علي" };
    expect(await findDuplicate(holder(person), "d1", "IL", "5")).toEqual({ id: "d2", name: "سارة علي" });
    expect(await findDuplicate(holder([person]), "d1", "IL", "5")).toEqual({ id: "d2", name: "سارة علي" });
    expect(await findDuplicate(holder(null), "d1", "IL", "5")).toEqual({ id: "d2", name: "" });
  });
});
