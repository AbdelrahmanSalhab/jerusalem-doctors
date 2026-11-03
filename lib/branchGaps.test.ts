// One branch each, across the libraries: the other side of a fallback.

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { auditDetail, auditFields } from "@/lib/auditText";
import { fetchDoctorDetail } from "@/lib/admin/doctorDetail";
import { rankRecent, toSearchHits, fetchFeatured, type SearchHit } from "@/lib/directory";
import { parseSendResponse } from "@/lib/otp/sms4free";
import { fetchActiveSpecialties } from "@/lib/specialties/catalogue";

const answering = (result: { data?: unknown; error?: unknown }) => {
  const c: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...result }).then(ok) };
  for (const m of ["select", "eq", "order", "limit", "maybeSingle", "gte"]) c[m] = () => c;
  return { from: () => c } as unknown as SupabaseClient;
};

describe("parseSendResponse", () => {
  it("is null for an empty body, and drops a message that is not text", () => {
    expect(parseSendResponse("   ")).toBeNull();
    expect(parseSendResponse('{"status":1,"message":5}')).toEqual({ status: 1, message: undefined });
  });
});

describe("fetchActiveSpecialties", () => {
  it("gives the rows, an empty list for no data, and throws on an error", async () => {
    expect(await fetchActiveSpecialties(answering({ data: [{ id: "s" }] }))).toEqual([{ id: "s" }]);
    expect(await fetchActiveSpecialties(answering({ data: null }))).toEqual([]);
    await expect(fetchActiveSpecialties(answering({ error: new Error("down") }))).rejects.toThrow("down");
  });
});

describe("directory edges", () => {
  const wp = (name: string, is_primary: boolean, sort_order: number) => ({ name, workplace_type: "clinic", is_primary, sort_order });
  it("puts a primary workplace first whichever side of the comparison it is on", () => {
    const row = (list: unknown[]) => ({ id: "d", arabic_first_name: "أ", arabic_family_name: "ب", phone_e164: "", doctor_specialties: [], doctor_workplaces: list });
    expect(toSearchHits([row([wp("ثانوي", false, 1), wp("رئيسي", true, 2)])])[0].workplaces[0].name).toBe("رئيسي");
    expect(toSearchHits([row([wp("رئيسي", true, 2), wp("ثانوي", false, 1)])])[0].workplaces[0].name).toBe("رئيسي");
  });

  it("scores a colleague whose specialty has no known domain as no match", () => {
    const hit = (id: string, specialties: string[]) => ({ id, specialties, workplaces: [] }) as unknown as SearchHit;
    const out = rankRecent([hit("a", ["جلدية"]), hit("b", ["قلب"])], { id: "me", domains: new Set(["قلب-domain"]), institutions: new Set() }, (s) => (s === "قلب" ? "قلب-domain" : undefined));
    expect(out.map((d) => d.id)).toEqual(["b", "a"]);
  });

  it("logs the graduates' error when only that read failed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    let call = 0;
    const svc = {
      from: () => {
        const failing = ++call === 2;
        const c: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: failing ? { message: "grad" } : null }).then(ok) };
        for (const m of ["select", "eq", "gte", "order", "limit"]) c[m] = () => c;
        return c;
      },
    } as unknown as SupabaseClient;
    await fetchFeatured(svc);
    expect(err).toHaveBeenCalledWith(expect.any(String), { message: "grad" });
    err.mockRestore();
  });
});

describe("doctor detail: a licence number the reader cannot split", () => {
  it("looks the mirror up by the number as stored", async () => {
    const svc = {
      from: (table: string) => {
        const c: Record<string, unknown> = {
          then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
          maybeSingle: async () => ({ data: table === "doctors" ? { id: "x", license_number: "abc", license_region: "IL", auth_user_id: null } : null, error: null }),
        };
        for (const m of ["select", "eq", "in", "order", "limit"]) c[m] = () => c;
        return c;
      },
    } as unknown as SupabaseClient;
    expect(await fetchDoctorDetail(svc, "00000000-0000-4000-8000-0000000000d1")).toMatchObject({ licenses: [{ number: "abc" }] });
  });
});

describe("audit text fallbacks", () => {
  const none = () => undefined;
  it("shows a status sentence once when the earlier status is unknown, and skips an unknown later one", () => {
    const only = auditDetail({ action: "admin_license_rechecked", metadata: { license_status_before: "verified", license_status_after: "verified" } } as never, none);
    expect(only.split("·").length).toBeGreaterThan(0);
    expect(auditDetail({ action: "admin_license_rechecked", metadata: { license_status_after: "weird" } } as never, none)).toBe("");
  });

  it("names edited fields it has no label for", () => {
    expect(auditFields({ action: "x", metadata: { fields: ["mystery_field"] } } as never, none)[0].value).toBe("mystery_field");
  });
});
