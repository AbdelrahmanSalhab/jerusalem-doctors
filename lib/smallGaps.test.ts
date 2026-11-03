// The small helpers' remaining edges: wording at the number boundaries, and
// what each read does with a database error.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fetchAdminStats } from "@/lib/adminStats";
import { daysAgoText } from "@/lib/arabicCount";
import { ipFromHeaders, zodFields } from "@/lib/api/respond";
import { readMirrorRows } from "@/lib/moh/mirror";
import { saveRegistryRows } from "@/lib/moh/registry";
import { failureText } from "@/lib/otp/failureText";
import { validityText } from "@/lib/otp/expiry";
import { isKnownRecipient } from "@/lib/otp/recipients";
import { codeSummary, NO_CODES } from "@/lib/otp/summary";
import { doctorByLicense, fileReport } from "@/lib/reports";
import { NO_FILTERS, searchParamsOf } from "@/lib/searchFilters";
import { verifyTurnstile } from "@/lib/turnstile";

/** A client whose every table answers `result`, whatever is asked. */
function answering(result: { data?: unknown; error?: unknown }): SupabaseClient {
  const chain: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...result }).then(ok) };
  for (const m of ["select", "eq", "gt", "in", "or", "limit", "insert", "upsert", "maybeSingle", "single"]) chain[m] = () => chain;
  return { from: () => chain, rpc: async () => ({ data: null, error: null, ...result }) } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Arabic wording at the boundaries", () => {
  it("counts days the way Arabic does", () => {
    expect([0, 1, 2, 5, 11, 21, 101, 111].map(daysAgoText)).toEqual([
      "اليوم", "منذ يوم", "منذ يومين", "منذ 5 أيام", "منذ 11 يومًا", "منذ 21 يومًا", "منذ 101 يوم", "منذ 111 يومًا",
    ]);
  });

  it("says how long a code lives", () => {
    expect([60, 120, 600, 900].map((s) => validityText(s))).toEqual(["دقيقة واحدة", "دقيقتين", "10 دقائق", "15 دقيقة"]);
  });

  it("explains each way a text failed", () => {
    for (const reason of ["sms4free_timeout", "sms4free_unreadable", "number_not_deliverable", "provider_config", "sms4free_http_503", "sms4free_status_-99"]) {
      expect(failureText(reason)).not.toBe(reason);
    }
    expect(failureText("sms4free_http_503")).toContain("503");
  });

  it("lists every code count that is above zero", () => {
    const all = { ...NO_CODES, delivered: 1, undelivered: 2, failed: 3, voice: 4, refused: 5, resent: 6, locked: 1 };
    const text = codeSummary(all);
    for (const part of ["وصلت الرسالة: 1", "لم تصل: 2", "فشل الإرسال: 3", "مكالمة صوتية (رقم كوشير): 4", "رمز مرفوض: 5", "رمز جديد: 6", "تجاوز عدد المحاولات"]) {
      expect(text).toContain(part);
    }
    expect(codeSummary(NO_CODES)).toBe("");
  });
});

describe("request helpers", () => {
  it("keys a form-level zod issue as _", () => {
    const issues = z.object({ a: z.string() }).refine(() => false, { message: "no" }).safeParse({ a: "x" });
    expect(zodFields((issues as { error: z.ZodError }).error)).toEqual({ _: "no" });
  });

  it("takes the first forwarded address, else the real one, else unknown", () => {
    const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
    expect(ipFromHeaders(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(ipFromHeaders(req({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(ipFromHeaders(req({}))).toBe("unknown");
  });

  it("leaves a blank search out of the address", () => {
    expect(searchParamsOf({ q: "  ", specialtyId: "", filters: NO_FILTERS }).toString()).toBe("");
    expect(searchParamsOf({ q: " قلب ", specialtyId: "", filters: NO_FILTERS }).get("q")).toBe("قلب");
  });
});

describe("reads that fail", () => {
  it("throws what the database said, or nothing is trusted", async () => {
    const down = answering({ error: { message: "down" } });
    await expect(fetchAdminStats(down)).rejects.toMatchObject({ message: "down" });
    await expect(isKnownRecipient(down, "+972501234567")).rejects.toMatchObject({ message: "down" });
    await expect(fileReport(down, { source: "card", target_doctor_id: "d", details: "x" } as never)).rejects.toThrow("profile_reports insert failed: down");
    await expect(doctorByLicense(down, "123456")).rejects.toThrow("doctors read failed: down");
    await expect(readMirrorRows(down, ["123"])).rejects.toThrow("moh_practitioners read failed: down");
    await expect(saveRegistryRows(down, [{ license_number: 1 } as never])).rejects.toThrow("upsert failed: down");
  });

  it("finds a licence holder, a licence nobody holds, and refuses a number with unsafe characters", async () => {
    expect(await doctorByLicense(answering({ data: { id: "d9" } }), "1-189371")).toBe("d9");
    expect(await doctorByLicense(answering({ data: null }), "55")).toBeNull();
    expect(await doctorByLicense(answering({}), "5);drop")).toBeNull();
  });

  it("reads a recipient from either table, and nothing from an empty answer", async () => {
    expect(await isKnownRecipient(answering({ data: { id: "x" } }), "+972501234567")).toBe(true);
    expect(await isKnownRecipient(answering({ data: null }), "+972501234567")).toBe(false);
    expect((await readMirrorRows(answering({ data: null }), ["123", "abc"])).size).toBe(0);
    expect((await readMirrorRows(answering({}), ["abc"])).size).toBe(0);
    await expect(saveRegistryRows(answering({ error: { message: "never called" } }), [])).resolves.toBeUndefined();
  });
});

describe("verifyTurnstile when Cloudflare cannot be reached", () => {
  it("fails closed", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await verifyTurnstile("token", "1.1.1.1")).toEqual({ ok: false, errors: ["turnstile-unreachable"] });
  });
});
