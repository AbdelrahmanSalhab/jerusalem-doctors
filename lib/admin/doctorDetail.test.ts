// The admin's doctor panel data: what it reads, and what it does when parts
// are missing or fail.

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fetchDoctorDetail } from "./doctorDetail";

const ID = "00000000-0000-4000-8000-0000000000d1";
const DOCTOR = {
  id: ID,
  license_number: "189371",
  license_region: "IL",
  license_verification_status: "verified",
  license_verified_at: "2026-09-01T10:00:00Z",
  secondary_license_number: null,
  secondary_license_region: null,
  secondary_license_verification_status: null,
  hebrew_first_name: "א",
  hebrew_family_name: "ב",
  auth_user_id: null as string | null,
};

type Result = { data?: unknown; error?: unknown };
function client(tables: Record<string, Result>, lastSignIn: string | Error | null = null) {
  return {
    from(table: string) {
      const result = tables[table] ?? {};
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...result }).then(ok),
        maybeSingle: () => Promise.resolve({ data: null, error: null, ...result }),
      };
      for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
      return chain;
    },
    auth: {
      admin: {
        getUserById: async () => {
          if (lastSignIn instanceof Error) throw lastSignIn;
          return { data: { user: lastSignIn ? { last_sign_in_at: lastSignIn } : null } };
        },
      },
    },
  } as unknown as SupabaseClient;
}

describe("fetchDoctorDetail", () => {
  it("is not found for an id that is not an id, or a row that is not there", async () => {
    expect(await fetchDoctorDetail(client({}), "abc")).toBeNull();
    expect(await fetchDoctorDetail(client({ doctors: { data: null } }), ID)).toBeNull();
    expect(await fetchDoctorDetail(client({ doctors: { data: null, error: { code: "PGRST116", message: "none" } } }), ID)).toBeNull();
  });

  it("throws on any other read error", async () => {
    await expect(fetchDoctorDetail(client({ doctors: { error: { code: "XX", message: "boom" } } }), ID)).rejects.toThrow("doctor read failed: boom");
  });

  it("gives empty lists when the related reads return nothing", async () => {
    const out = await fetchDoctorDetail(client({ doctors: { data: DOCTOR } }), ID);
    expect(out).toMatchObject({ specialties: [], specialtyIds: [], workplaces: [], audit: [], lastSignInAt: null });
    expect(out!.licenses).toHaveLength(1);
  });

  it("adds the second licence, names specialties from either embed shape, and reads the last sign-in", async () => {
    const out = await fetchDoctorDetail(
      client(
        {
          doctors: { data: { ...DOCTOR, secondary_license_number: "55", secondary_license_region: "PS", secondary_license_verification_status: "not_found", auth_user_id: "u1" } },
          doctor_specialties: {
            data: [
              { specialty_id: "s1", specialty: { name_ar: "جلدية" } },
              { specialty_id: "s2", specialty: [{ name_ar: "أطفال" }] },
              { specialty_id: "s3", specialty: null },
            ],
          },
          doctor_workplaces: { data: [{ name: "المقاصد" }] },
          audit_logs: { data: [{ id: "a1" }] },
        },
        "2026-10-30T08:00:00Z",
      ),
      ID,
    );
    expect(out!.licenses.map((l) => l.slot)).toEqual(["primary", "secondary"]);
    expect(out!.specialties).toEqual(["جلدية", "أطفال"]);
    expect(out!.specialtyIds).toEqual(["s1", "s2", "s3"]);
    expect(out).toMatchObject({ workplaces: [{ name: "المقاصد" }], audit: [{ id: "a1" }], lastSignInAt: "2026-10-30T08:00:00Z" });
  });

  it("never fails the panel over the sign-in time", async () => {
    const withAuth = { doctors: { data: { ...DOCTOR, auth_user_id: "u1" } } };
    expect((await fetchDoctorDetail(client(withAuth, new Error("auth down")), ID))!.lastSignInAt).toBeNull();
    expect((await fetchDoctorDetail(client(withAuth, null), ID))!.lastSignInAt).toBeNull();
  });
});
